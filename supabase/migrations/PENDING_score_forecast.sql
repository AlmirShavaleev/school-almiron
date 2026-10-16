-- Прогноз балла ЕГЭ — считать раз в день и хранить, сайт только читает
-- (письмо ЛК_прогноз_балла_хранить.md, 16.10). ТОЛЬКО ДОБАВЛЯЕТ: новая таблица,
-- новые функции, новое задание pg_cron. Существующие функции не меняются.
--
-- Применяет оркестратор (MCP apply_migration) после «да» владельца; потом —
-- деплой Edge Function `forecast-daily` (supabase/functions/forecast-daily).
--
--   1. student_score_forecast        — строка на (ученик, предмет): балл, диапазон,
--                                      основание, details (подсказки, сводка), когда посчитано.
--                                      RLS без политик: только definer-функции.
--   2. score_forecast_batch(after, limit, profile)
--                                    — для Edge Function (service_role): пачка учеников и
--                                      их свидетельства — ТОТ ЖЕ student_forecast_evidence_of,
--                                      что у браузера (сама она закрыта от всех ролей).
--   3. score_forecast_store(rows, profiles)
--                                    — для Edge Function (service_role): upsert строк пачки
--                                      и снятие предметов, которых у ученика больше нет.
--   4. my_score_forecast()           — ученику: свои строки (простой select).
--   5. course_score_forecast(course) — персоналу курса (course_is_staff): строки учеников курса.
--   6. student_score_forecast(student)
--                                    — карточка ученика у персонала (как student_overview_for_staff:
--                                      админ или auth_is_staff_of_student).
--   7. pg_cron `forecast-daily`      — раз в день 04:10 МСК (01:10 UTC), секрет из vault
--                                      'cron_secret', как student-reminders / subscription-renew.
--
-- student_forecast_marks (достижения) не трогается.

begin;
set local lock_timeout = '5s';

-- ── 1. Таблица ──────────────────────────────────────────────────────────────

create table if not exists public.student_score_forecast (
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  subject     text        not null check (subject in ('physics', 'math')),
  -- Тестовый балл как на карточке (округлён); null — данных пока мало (details.ready = false).
  score       integer     check (score between 0 and 100),
  low         integer     check (low between 0 and 100),
  high        integer     check (high between 0 and 100),
  -- «по 46 задачам и 1 пробнику».
  basis       text        not null default '',
  -- Компактно: ready, covered/need/missing, month_delta, week_ago, trend, tips, sources, numbers.
  details     jsonb       not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (profile_id, subject)
);

comment on table public.student_score_forecast is
  'Прогноз балла ЕГЭ ученика по предмету — считает раз в день Edge Function forecast-daily (модель §255, supabase/functions/_shared/scoreForecast.ts — тот же код, что в браузере). Сайт читает my_score_forecast / course_score_forecast / student_score_forecast. RLS без политик.';

alter table public.student_score_forecast enable row level security;
revoke all on table public.student_score_forecast from anon, authenticated;

-- ── 2. Пачка учеников со свидетельствами (service_role) ─────────────────────

create or replace function public.score_forecast_batch(
  p_after      uuid    default null,
  p_limit      integer default 40,
  p_profile_id uuid    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  -- Кому считать: в группе курса, с действующей подпиской/пробным, или решал
  -- в каталоге за 60 дней. Порядок — по profile_id (курсор p_after).
  select coalesce(array_agg(t.pid order by t.pid), '{}'::uuid[]) into v_ids
    from (
      select s.profile_id as pid
        from public.students s
       where s.profile_id is not null
         and (p_profile_id is null or s.profile_id = p_profile_id)
         and (p_after is null or s.profile_id > p_after)
         and (
           exists (select 1 from public.group_students gs where gs.student_id = s.id)
           or exists (
             select 1 from public.student_courses sc
              where sc.student_id = s.id and sc.status in ('active', 'trial')
                and (sc.expires_at is null or sc.expires_at > now())
           )
           or exists (
             select 1 from public.catalog_task_attempts a
              where a.profile_id = s.profile_id and a.created_at > now() - interval '60 days'
           )
         )
       group by s.profile_id
       order by s.profile_id
       limit least(greatest(coalesce(p_limit, 40), 1), 200)
    ) t;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', x.pid,
             'evidence',   public.student_forecast_evidence_of(x.pid, now())
           ) order by x.pid)
      from unnest(v_ids) as x(pid)
  ), '[]'::jsonb);
end
$$;

comment on function public.score_forecast_batch(uuid, integer, uuid) is
  'Прогноз балла: пачка учеников (курсор p_after по profile_id, до 200) и их свидетельства student_forecast_evidence_of(profile, now()) — тот же ответ, что считает браузер. p_profile_id — один ученик (пересчёт по событию). Только service_role (Edge Function forecast-daily).';

revoke all on function public.score_forecast_batch(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.score_forecast_batch(uuid, integer, uuid) to service_role;

-- ── 3. Запись пачки (service_role) ──────────────────────────────────────────

create or replace function public.score_forecast_store(p_rows jsonb, p_profiles uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  insert into public.student_score_forecast as f
         (profile_id, subject, score, low, high, basis, details, computed_at)
  select (x->>'profile_id')::uuid,
         x->>'subject',
         (x->>'score')::integer,
         (x->>'low')::integer,
         (x->>'high')::integer,
         coalesce(x->>'basis', ''),
         coalesce(x->'details', '{}'::jsonb),
         coalesce((x->>'computed_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as x
   where x->>'subject' in ('physics', 'math')
     and exists (select 1 from public.profiles p where p.id = (x->>'profile_id')::uuid)
  on conflict (profile_id, subject) do update
     set score = excluded.score, low = excluded.low, high = excluded.high,
         basis = excluded.basis, details = excluded.details, computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;

  -- Предмет ушёл (выбыл из курса) — его строку снимаем, иначе висела бы вечно.
  delete from public.student_score_forecast f
   where f.profile_id = any(coalesce(p_profiles, '{}'::uuid[]))
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as x
        where (x->>'profile_id')::uuid = f.profile_id and x->>'subject' = f.subject
     );
  return v_n;
end
$$;

comment on function public.score_forecast_store(jsonb, uuid[]) is
  'Прогноз балла: upsert строк пачки forecast-daily и удаление предметов, которых у учеников пачки (p_profiles) больше нет. Только service_role.';

revoke all on function public.score_forecast_store(jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.score_forecast_store(jsonb, uuid[]) to service_role;

-- ── 4–6. Чтение ─────────────────────────────────────────────────────────────

create or replace function public.my_score_forecast()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'subject', f.subject, 'score', f.score, 'low', f.low, 'high', f.high,
           'basis', f.basis, 'details', f.details, 'computed_at', f.computed_at
         ) order by f.subject), '[]'::jsonb)
    from public.student_score_forecast f
   where f.profile_id = auth.uid()
$$;

comment on function public.my_score_forecast() is
  'Прогноз балла ученика по предметам (посчитан ночью forecast-daily). Только свои строки, от auth.uid().';

revoke all on function public.my_score_forecast() from public, anon;
grant execute on function public.my_score_forecast() to authenticated;

create or replace function public.course_score_forecast(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_course_id is null or not public.course_is_staff(p_course_id) then
    raise exception 'ACCESS_DENIED: только персонал курса' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', s.id, 'profile_id', s.profile_id,
             'subject', f.subject, 'score', f.score, 'low', f.low, 'high', f.high,
             'basis', f.basis, 'details', f.details, 'computed_at', f.computed_at
           ) order by s.id, f.subject)
      from public.students s
      join public.student_score_forecast f on f.profile_id = s.profile_id
     where s.id = any(public._course_student_ids(p_course_id))
  ), '[]'::jsonb);
end
$$;

comment on function public.course_score_forecast(uuid) is
  'Прогноз балла учеников курса (сводка класса). Только персонал курса (course_is_staff), иначе 42501.';

revoke all on function public.course_score_forecast(uuid) from public, anon;
grant execute on function public.course_score_forecast(uuid) to authenticated;

create or replace function public.student_score_forecast(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_student_id is null
     or not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'ACCESS_DENIED: только персонал курса ученика' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'subject', f.subject, 'score', f.score, 'low', f.low, 'high', f.high,
             'basis', f.basis, 'details', f.details, 'computed_at', f.computed_at
           ) order by f.subject)
      from public.students s
      join public.student_score_forecast f on f.profile_id = s.profile_id
     where s.id = p_student_id
  ), '[]'::jsonb);
end
$$;

comment on function public.student_score_forecast(uuid) is
  'Прогноз балла ученика для карточки у персонала — те же права, что student_overview_for_staff (админ или персонал курса ученика), иначе 42501.';

revoke all on function public.student_score_forecast(uuid) from public, anon;
grant execute on function public.student_score_forecast(uuid) to authenticated;

-- ── 7. pg_cron: раз в день 04:10 МСК ────────────────────────────────────────

do $mig$
begin
  -- Две вложенные проверки: выражение «… and not exists (select … from cron.job)» PL/pgSQL
  -- планирует целиком и падает там, где pg_cron нет (локальная проверка).
  if to_regclass('cron.job') is null then
    raise notice 'forecast-daily: pg_cron нет — задание не создано';
  elsif not exists (select 1 from cron.job where jobname = 'forecast-daily') then
    perform cron.schedule(
      'forecast-daily',
      '10 1 * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/forecast-daily',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
    );
  end if;
end
$mig$;

commit;

-- Сверка после применения (под владельцем таблиц RLS не проверить — права
-- проверять под authenticated, см. CLAUDE.md):
--   select count(*) from public.student_score_forecast;                 -- 0 до первого прогона
--   select jsonb_array_length(public.score_forecast_batch(null, 5, null)); -- под service_role: ≤ 5
--   select jobname, schedule from cron.job where jobname = 'forecast-daily';
