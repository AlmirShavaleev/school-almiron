-- §289 (часть A) — стартовая диагностика ученика. ТОЛЬКО ДОБАВЛЕНИЕ: новые
-- таблицы, функции и триггер. Существующие функции не меняются — прогноз
-- подключает часть B (PENDING_289_b_forecast.sql) двумя вставками по якорю.
--
-- Решения владельца (план §289 принят 13.10):
--   • только первая часть ЕГЭ (№1–20), автопроверка; ≤ 20 задач;
--   • 10 блоков соседних номеров. В блоке: 1-я — средняя по первому номеру;
--     верно → сложная по другому номеру блока (нет — средняя); неверно / «Не
--     знаю» → лёгкая по тому же номеру; блок из одного номера после верного
--     ответа пропускается;
--   • в прогноз: верно средняя/сложная — 1, верно лёгкая — 0,5, иначе 0;
--     в серии, баллы, «Решено задач» и награды — НЕТ (ответы не пишутся в
--     catalog_task_attempts);
--   • во время теста правильность не показывается, на экране результата —
--     «твой ответ / верный ответ»;
--   • открытия уроков по «зелёным» номерам — только курсы 'progress' с
--     ОПЛАЧЕННОЙ подпиской (в демо — нет); ручные отметки не трогаются;
--   • пройти заново — только по кнопке персонала.
--
-- Набор задач версионный (diagnostic_sets): утверждённый набор подставляется
-- вызовом admin_diagnostic_set_load(...) без кода. Здесь заведён черновик —
-- временная заглушка до набора агента подборок.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Таблицы
-- ─────────────────────────────────────────────────────────────────────────

create table public.diagnostic_sets (
  id         uuid primary key default gen_random_uuid(),
  subject    text not null check (subject in ('physics', 'math')),
  exam       text not null default 'ege' check (exam in ('ege')),
  version    text not null,
  -- {"1": {"title": "...", "лёгкая": [task uuid…], "средняя": […], "сложная": […]}, …}
  tasks      jsonb not null,
  -- номера блоков по порядку прохождения
  blocks     jsonb not null default '[[1,2],[3,4],[5,6],[7,8],[9,10],[11,12],[13],[14,15],[16,17],[18,19,20]]',
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (subject, exam, version)
);
create unique index diagnostic_sets_one_active on public.diagnostic_sets (subject, exam) where is_active;

create table public.diagnostic_sessions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  set_id          uuid not null references public.diagnostic_sets(id),
  subject         text not null,
  status          text not null default 'in_progress' check (status in ('in_progress', 'done')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  -- текущая задача (null — тест окончен)
  current_task_id uuid references public.catalog_tasks(id),
  current_block   int,
  current_step    int,
  current_n       int,
  current_level   text,
  current_shown_at timestamptz,
  unique (profile_id, subject)
);

create table public.diagnostic_answers (
  id         bigint generated always as identity primary key,
  session_id uuid not null references public.diagnostic_sessions(id) on delete cascade,
  profile_id uuid not null,
  task_id    uuid not null references public.catalog_tasks(id),
  n          int not null,
  level      text not null check (level in ('лёгкая', 'средняя', 'сложная')),
  block      int not null,
  step       int not null,
  answer     text,
  verdict    text not null check (verdict in ('correct', 'wrong', 'dont_know')),
  score      numeric not null,
  ms         int,
  created_at timestamptz not null default now(),
  unique (session_id, block, step)
);
create index diagnostic_answers_profile_idx on public.diagnostic_answers (profile_id, created_at);

-- Только definer-функции: ученик видит своё, персонал — своих учеников.
alter table public.diagnostic_sets enable row level security;
alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_answers enable row level security;
revoke all on public.diagnostic_sets from anon, authenticated;
revoke all on public.diagnostic_sessions from anon, authenticated;
revoke all on public.diagnostic_answers from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Набор: загрузка по external_id (формат файла набора)
--    p_numbers = [{"n": 1, "title": "...", "tasks": {"лёгкая": [ext…], …}}, …]
-- ─────────────────────────────────────────────────────────────────────────

create function public.admin_diagnostic_set_load(p_subject text, p_version text, p_numbers jsonb, p_activate boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cat_subject text := case p_subject when 'physics' then 'Физика' when 'math' then 'Математика' end;
  v_tasks   jsonb := '{}'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_total   int := 0;
  r_num     jsonb;
  v_lvl     text;
  v_ext     bigint;
  v_id      uuid;
  v_ids     jsonb;
  v_set     uuid;
begin
  -- из SQL Editor / миграции (без входа) — можно; из приложения — только админ
  if auth.uid() is not null and not public.is_admin_or_owner() then
    raise exception 'Только администратор' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  if v_cat_subject is null then
    raise exception 'Неизвестный предмет' using errcode = 'P0001', hint = 'BAD_SUBJECT';
  end if;
  for r_num in select * from jsonb_array_elements(p_numbers) loop
    v_tasks := v_tasks || jsonb_build_object((r_num ->> 'n'), jsonb_build_object('title', r_num ->> 'title'));
    for v_lvl in select unnest(array['лёгкая', 'средняя', 'сложная']) loop
      v_ids := '[]'::jsonb;
      for v_ext in select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(r_num -> 'tasks' -> v_lvl, '[]'::jsonb)) x loop
        select ct.id into v_id
          from public.catalog_tasks ct
          join public.catalog_sections cs on cs.id = ct.section_id
         where ct.external_id = v_ext and ct.is_published and ct.auto_checkable
           and cs.subject = v_cat_subject and cs.exam_type = 'ЕГЭ'
           and cs.exam_number = (r_num ->> 'n')::int
         limit 1;
        if v_id is null then
          v_missing := v_missing || to_jsonb(v_ext);
        else
          v_ids := v_ids || to_jsonb(v_id);
          v_total := v_total + 1;
        end if;
      end loop;
      if jsonb_array_length(v_ids) > 0 then
        v_tasks := jsonb_set(v_tasks, array[r_num ->> 'n', v_lvl], v_ids);
      end if;
    end loop;
  end loop;

  insert into public.diagnostic_sets (subject, exam, version, tasks)
  values (p_subject, 'ege', p_version, v_tasks)
  on conflict (subject, exam, version) do update set tasks = excluded.tasks
  returning id into v_set;
  if p_activate then
    update public.diagnostic_sets set is_active = false where subject = p_subject and exam = 'ege' and id <> v_set and is_active;
    update public.diagnostic_sets set is_active = true where id = v_set;
  end if;
  return jsonb_build_object('set_id', v_set, 'version', p_version, 'tasks', v_total, 'missing', v_missing);
end $$;

revoke all on function public.admin_diagnostic_set_load(text, text, jsonb, boolean) from public, anon;
grant execute on function public.admin_diagnostic_set_load(text, text, jsonb, boolean) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Выбор следующей задачи
-- ─────────────────────────────────────────────────────────────────────────

-- Задача для (блок, шаг) с учётом ответа на 1-й шаг блока; null — шаг не нужен.
create function public._diag_pick(p_session uuid, p_block int, p_step int, p_prev text)
returns table (n int, level text, task_id uuid)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_set    public.diagnostic_sets%rowtype;
  v_nums   int[];
  v_n      int;
  v_levels text[];
  v_lvl    text;
  v_task   uuid;
begin
  select ds.* into v_set from public.diagnostic_sets ds
    join public.diagnostic_sessions s on s.set_id = ds.id where s.id = p_session;
  if p_block > jsonb_array_length(v_set.blocks) then return; end if;
  select array_agg((x #>> '{}')::int order by o) into v_nums
    from jsonb_array_elements(v_set.blocks -> (p_block - 1)) with ordinality as e(x, o);

  if p_step = 1 then
    v_n := v_nums[1];
    v_levels := array['средняя', 'лёгкая', 'сложная'];
  elsif p_prev = 'correct' then
    if cardinality(v_nums) < 2 then return; end if;
    v_n := v_nums[2 + floor(random() * (cardinality(v_nums) - 1))::int];
    v_levels := array['сложная', 'средняя'];
  else
    v_n := v_nums[1];
    v_levels := array['лёгкая', 'средняя'];
  end if;

  foreach v_lvl in array v_levels loop
    select (t #>> '{}')::uuid into v_task
      from jsonb_array_elements(coalesce(v_set.tasks -> v_n::text -> v_lvl, '[]'::jsonb)) t
     where (t #>> '{}')::uuid not in (select a.task_id from public.diagnostic_answers a where a.session_id = p_session)
     order by random() limit 1;
    if v_task is not null then
      n := v_n; level := v_lvl; task_id := v_task;
      return next;
      return;
    end if;
  end loop;
end $$;

-- Перейти к следующей задаче после (блок, шаг, вердикт); нет задач — тест окончен.
create function public._diag_advance(p_session uuid, p_block int, p_step int, p_verdict text)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_blocks int;
  v_b      int := p_block;
  v_s      int := p_step;
  v_prev   text := p_verdict;
  r        record;
begin
  select jsonb_array_length(ds.blocks) into v_blocks
    from public.diagnostic_sets ds join public.diagnostic_sessions s on s.set_id = ds.id where s.id = p_session;
  loop
    if v_s = 1 and v_prev is not null then
      v_s := 2;                       -- второй шаг того же блока
    else
      v_b := v_b + 1; v_s := 1; v_prev := null;
    end if;
    if v_b > v_blocks then
      update public.diagnostic_sessions
         set current_task_id = null, current_block = null, current_step = null,
             current_n = null, current_level = null, current_shown_at = null
       where id = p_session;
      return false;
    end if;
    select * into r from public._diag_pick(p_session, v_b, v_s, v_prev);
    if r.task_id is not null then
      update public.diagnostic_sessions
         set current_task_id = r.task_id, current_block = v_b, current_step = v_s,
             current_n = r.n, current_level = r.level, current_shown_at = now()
       where id = p_session;
      return true;
    end if;
    -- шага нет (блок из одного номера, задачи кончились) — дальше
    if v_s = 1 then v_prev := 'skip'; end if;
  end loop;
end $$;

revoke all on function public._diag_pick(uuid, int, int, text) from public, anon, authenticated;
revoke all on function public._diag_advance(uuid, int, int, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ответ ученику: текущая задача / результат
-- ─────────────────────────────────────────────────────────────────────────

create function public._diag_payload(p_session uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'session_id', s.id,
    'subject', s.subject,
    'status', s.status,
    'answered', (select count(*) from public.diagnostic_answers a where a.session_id = s.id),
    'max', 20,
    'task', case when s.current_task_id is null then null else (
      select jsonb_build_object(
               'id', ct.id, 'n', s.current_n,
               'title', ds.tasks -> s.current_n::text ->> 'title',
               'statement_html', ct.statement_html,
               'content_format', ct.content_format,
               'assets', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tex_session_id', x.tex_session_id, 'kind', x.kind,
                         'storage_path', x.storage_path, 'alt', x.alt, 'position', x.position) order by x.position)
                    from public.catalog_task_assets x where x.task_id = ct.id), '[]'::jsonb),
               'shown_at', s.current_shown_at)
        from public.catalog_tasks ct where ct.id = s.current_task_id) end)
    from public.diagnostic_sessions s
    join public.diagnostic_sets ds on ds.id = s.set_id
   where s.id = p_session;
$$;

-- Карта номеров, слабые места, ответы; null — диагностики не было.
create function public._diag_result(p_profile_id uuid, p_subject text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with s as (
    select s.*, ds.tasks from public.diagnostic_sessions s
      join public.diagnostic_sets ds on ds.id = s.set_id
     where s.profile_id = p_profile_id and s.subject = p_subject
  ),
  nums as (
    select k::int as n, s.tasks -> k ->> 'title' as title
      from s, jsonb_object_keys(s.tasks) k
  ),
  per as (
    select nums.n, nums.title,
           case
             when bool_or(a.verdict = 'correct' and a.level in ('средняя', 'сложная')) then 'green'
             when bool_or(a.verdict = 'correct') then 'yellow'
             when count(a.id) > 0 then 'red'
             else 'grey'
           end as status
      from nums left join public.diagnostic_answers a
        on a.session_id = (select id from s) and a.n = nums.n
     group by nums.n, nums.title
  ),
  weak as (
    select per.n, per.title from per where per.status in ('red', 'yellow')
     order by case per.status when 'red' then 0 else 1 end, per.n limit 3
  )
  select case when not exists (select 1 from s) then null else jsonb_build_object(
    'subject', p_subject,
    'status', (select status from s),
    'started_at', (select started_at from s),
    'finished_at', (select finished_at from s),
    'correct', (select count(*) from public.diagnostic_answers a where a.session_id = (select id from s) and a.verdict = 'correct'),
    'answered', (select count(*) from public.diagnostic_answers a where a.session_id = (select id from s)),
    'numbers', coalesce((select jsonb_agg(jsonb_build_object('n', n, 'title', title, 'status', status) order by n) from per), '[]'::jsonb),
    'weak', coalesce((select jsonb_agg(jsonb_build_object('n', n, 'title', title)) from weak), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'n', a.n, 'level', a.level, 'answer', a.answer, 'verdict', a.verdict,
               'title', (select tasks from s) -> a.n::text ->> 'title',
               'statement_html', ct.statement_html, 'correct_html', ct.answer_html,
               'assets', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tex_session_id', x.tex_session_id, 'kind', x.kind,
                         'storage_path', x.storage_path, 'alt', x.alt, 'position', x.position) order by x.position)
                    from public.catalog_task_assets x where x.task_id = ct.id), '[]'::jsonb))
             order by a.block, a.step)
        from public.diagnostic_answers a join public.catalog_tasks ct on ct.id = a.task_id
       where a.session_id = (select id from s) and (select status from s) = 'done'), '[]'::jsonb),
    'onboarding', (select jsonb_build_object('grade', o.grade, 'target_score', o.target_score,
                                             'months_to_exam', o.months_to_exam, 'hours_per_week', o.hours_per_week)
                     from public.student_onboarding o where o.profile_id = p_profile_id))
  end;
$$;

revoke all on function public._diag_payload(uuid) from public, anon, authenticated;
revoke all on function public._diag_result(uuid, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Открытия по диагностике (курсы 'progress' с оплаченной подпиской)
-- ─────────────────────────────────────────────────────────────────────────

-- «Зелёные» номера → отметка open на уроки, все номера которых зелёные.
-- Ручные отметки (и 'closed') не трогаются; демо — не открывает.
create function public._diag_apply_opens(p_student_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_n int := 0;
begin
  select st.profile_id into v_profile from public.students st where st.id = p_student_id;
  if v_profile is null then return 0; end if;
  with green as (
    select s.subject, a.n
      from public.diagnostic_sessions s join public.diagnostic_answers a on a.session_id = s.id
     where s.profile_id = v_profile and s.status = 'done'
     group by s.subject, a.n
    having bool_or(a.verdict = 'correct' and a.level in ('средняя', 'сложная'))
  ),
  courses as (
    select ss.course_id, c.subject::text as subject
      from public.student_subscriptions ss join public.courses c on c.id = ss.course_id
     where ss.student_id = p_student_id and ss.status = 'active' and ss.access_until > now()
       and public.course_is_progress(ss.course_id)
  ),
  targets as (
    select t.id as topic_id
      from courses cr
      join public.modules m on m.course_id = cr.course_id
      join public.topics t on t.module_id = m.id
     where cardinality(t.ege_task_numbers) > 0
       and not exists (select 1 from unnest(t.ege_task_numbers) x(n)
                        where x.n::int not in (select g.n from green g where g.subject = cr.subject))
  ),
  ins as (
    insert into public.student_topic_overrides (student_id, topic_id, state, note)
    select p_student_id, tg.topic_id, 'open', 'диагностика' from targets tg
    on conflict (student_id, topic_id) do nothing
    returning topic_id
  ),
  logged as (
    insert into public.student_topic_override_log (student_id, topic_id, old_state, new_state, note, action)
    select p_student_id, ins.topic_id, null, 'open', 'диагностика', 'diagnostic' from ins
    returning 1
  )
  select count(*) into v_n from logged;
  return v_n;
end $$;

revoke all on function public._diag_apply_opens(uuid) from public, anon, authenticated;

-- Подписка стала оплаченной — открыть по уже пройденной диагностике.
create function public._diag_on_subscription_active()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    begin
      perform public._diag_apply_opens(new.student_id);
    exception when others then
      raise warning '§289 diagnostic opens: % (%)', sqlerrm, sqlstate;
    end;
  end if;
  return new;
end $$;

create trigger student_subscriptions_diag_opens
  after insert or update of status on public.student_subscriptions
  for each row execute function public._diag_on_subscription_active();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPC ученика
-- ─────────────────────────────────────────────────────────────────────────

-- Начать или продолжить. Пройдена — {status: 'done'} без задачи.
create function public.diagnostic_start(p_subject text default 'physics')
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_set  uuid;
  v_sess public.diagnostic_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'Требуется вход' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'student' then
    raise exception 'Диагностику проходит ученик' using errcode = '42501', hint = 'NOT_STUDENT';
  end if;
  select * into v_sess from public.diagnostic_sessions where profile_id = v_uid and subject = p_subject for update;
  if not found then
    select id into v_set from public.diagnostic_sets where subject = p_subject and exam = 'ege' and is_active;
    if v_set is null then
      raise exception 'Диагностика по предмету пока недоступна' using errcode = 'P0001', hint = 'NO_SET';
    end if;
    insert into public.diagnostic_sessions (profile_id, set_id, subject)
    values (v_uid, v_set, p_subject)
    on conflict (profile_id, subject) do nothing
    returning * into v_sess;
    if v_sess.id is null then
      select * into v_sess from public.diagnostic_sessions where profile_id = v_uid and subject = p_subject;
    else
      if not public._diag_advance(v_sess.id, 0, 1, null) then
        -- набор без задач (не загружен) — как будто его нет; вставка откатится
        raise exception 'Диагностика по предмету пока недоступна' using errcode = 'P0001', hint = 'NO_SET';
      end if;
      update public.student_onboarding set diagnostic_status = 'in_progress', updated_at = now()
       where profile_id = v_uid and diagnostic_status in ('none', 'skipped');
    end if;
  elsif v_sess.status = 'in_progress' and v_sess.current_task_id is not null then
    -- продолжение: время задачи — с возврата
    update public.diagnostic_sessions set current_shown_at = now() where id = v_sess.id;
  end if;
  return public._diag_payload(v_sess.id);
end $$;

-- Ответ на текущую задачу (или «Не знаю») → следующая задача или «готово».
create function public.diagnostic_answer(p_session uuid, p_task uuid, p_answer text, p_dont_know boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_sess    public.diagnostic_sessions%rowtype;
  v_task    record;
  v_answer  text := btrim(coalesce(p_answer, ''));
  v_verdict text;
  v_correct boolean;
  v_more    boolean;
  v_student uuid;
begin
  select * into v_sess from public.diagnostic_sessions where id = p_session for update;
  if not found or v_sess.profile_id is distinct from v_uid then
    raise exception 'Диагностика не найдена' using errcode = '42501', hint = 'NOT_FOUND';
  end if;
  if v_sess.status <> 'in_progress' or v_sess.current_task_id is distinct from p_task then
    -- двойное нажатие / старая вкладка: экран перечитает текущее состояние
    raise exception 'Задача уже сменилась' using errcode = 'P0001', hint = 'STALE';
  end if;
  if not coalesce(p_dont_know, false) and v_answer = '' then
    raise exception 'Введите ответ или нажмите «Не знаю»' using errcode = 'P0001', hint = 'EMPTY';
  end if;

  if coalesce(p_dont_know, false) then
    v_verdict := 'dont_know';
  else
    select ct.answer_html, ct.answer_spec, ct.partial_type into v_task from public.catalog_tasks ct where ct.id = p_task;
    -- та же проверка, что в каталоге (catalog_check_answer); второй копии нет
    v_correct := case when v_task.answer_spec is not null
                      then coalesce(public.catalog_answer_spec_verdict(v_task.answer_spec, v_answer), false)
                      else coalesce(public.catalog_task_verdict(v_task.answer_html, v_task.partial_type, v_answer), false) end;
    v_verdict := case when v_correct then 'correct' else 'wrong' end;
  end if;

  insert into public.diagnostic_answers (session_id, profile_id, task_id, n, level, block, step, answer, verdict, score, ms)
  values (v_sess.id, v_uid, p_task, v_sess.current_n, v_sess.current_level, v_sess.current_block, v_sess.current_step,
          nullif(v_answer, ''), v_verdict,
          case when v_verdict <> 'correct' then 0 when v_sess.current_level = 'лёгкая' then 0.5 else 1 end,
          least(3600000, greatest(0, (extract(epoch from now() - v_sess.current_shown_at) * 1000)::int)));

  v_more := public._diag_advance(v_sess.id, v_sess.current_block, v_sess.current_step,
                                 case when v_verdict = 'correct' then 'correct' else 'wrong' end);
  if not v_more then
    update public.diagnostic_sessions set status = 'done', finished_at = now() where id = v_sess.id;
    update public.student_onboarding set diagnostic_status = 'done', updated_at = now() where profile_id = v_uid;
    select id into v_student from public.students where profile_id = v_uid;
    if v_student is not null then
      begin
        perform public._diag_apply_opens(v_student);
      exception when others then
        raise warning '§289 diagnostic opens: % (%)', sqlerrm, sqlstate;
      end;
    end if;
  end if;
  return public._diag_payload(v_sess.id);
end $$;

create function public.diagnostic_result(p_subject text default 'physics')
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public._diag_result(auth.uid(), p_subject);
$$;

revoke all on function public.diagnostic_start(text) from public, anon;
revoke all on function public.diagnostic_answer(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.diagnostic_result(text) from public, anon;
grant execute on function public.diagnostic_start(text) to authenticated, service_role;
grant execute on function public.diagnostic_answer(uuid, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.diagnostic_result(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Персоналу: результат, «пройти заново», значок на «Прохождении»
-- ─────────────────────────────────────────────────────────────────────────

-- Персонал ученика: админ или персонал любого курса, где ученик в группе.
create function public._diag_staff_of(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_admin_or_owner()
      or exists (select 1 from public.group_students gs join public.groups g on g.id = gs.group_id
                  where gs.student_id = p_student_id and public.course_is_staff(g.course_id));
$$;
revoke all on function public._diag_staff_of(uuid) from public, anon, authenticated;

create function public.diagnostic_result_for(p_student_id uuid, p_subject text default 'physics')
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public._diag_staff_of(p_student_id) then
    raise exception 'Нет доступа' using errcode = '42501', hint = 'NOT_STAFF';
  end if;
  return public._diag_result((select profile_id from public.students where id = p_student_id), p_subject);
end $$;

create function public.diagnostic_reset(p_student_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
begin
  if not public._diag_staff_of(p_student_id) then
    raise exception 'Нет доступа' using errcode = '42501', hint = 'NOT_STAFF';
  end if;
  select profile_id into v_profile from public.students where id = p_student_id;
  -- ответы удаляются вместе с сессией; открытые уроки остаются
  delete from public.diagnostic_sessions where profile_id = v_profile;
  update public.student_onboarding set diagnostic_status = 'none', updated_at = now() where profile_id = v_profile;
  return true;
end $$;

-- Значки «Диагн. 14/18» для экрана «Прохождение».
create function public.course_diagnostics(p_course_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа' using errcode = '42501', hint = 'NOT_STAFF';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'student_id', st.id, 'status', s.status, 'finished_at', s.finished_at,
             'correct', (select count(*) from public.diagnostic_answers a where a.session_id = s.id and a.verdict = 'correct'),
             'answered', (select count(*) from public.diagnostic_answers a where a.session_id = s.id)))
      from unnest(public._course_student_ids(p_course_id)) x(id)
      join public.students st on st.id = x.id
      join public.diagnostic_sessions s on s.profile_id = st.profile_id), '[]'::jsonb);
end $$;

revoke all on function public.diagnostic_result_for(uuid, text) from public, anon;
revoke all on function public.diagnostic_reset(uuid) from public, anon;
revoke all on function public.course_diagnostics(uuid) from public, anon;
grant execute on function public.diagnostic_result_for(uuid, text) to authenticated, service_role;
grant execute on function public.diagnostic_reset(uuid) to authenticated, service_role;
grant execute on function public.course_diagnostics(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Для прогноза (подключает часть B): строки ответов и предметы
-- ─────────────────────────────────────────────────────────────────────────

-- В формате student_exam_evidence_rows; source 'catalog', item 'diag:…'.
create function public.diagnostic_evidence_rows(p_profile_id uuid, p_from timestamptz)
returns table (subject text, ns integer[], source text, score numeric, at timestamptz, item text, kim_total integer)
language sql stable
set search_path = public, pg_temp
as $$
  select s.subject, array[a.n], 'catalog'::text, a.score, a.created_at, 'diag:' || a.id::text, null::int
    from public.diagnostic_answers a
    join public.diagnostic_sessions s on s.id = a.session_id
   where a.profile_id = p_profile_id and a.created_at >= p_from;
$$;

-- Предметы пройденной диагностики — прогноз у ученика без группы (до пробного).
create function public.diagnostic_done_subjects(p_profile_id uuid)
returns table (subject text)
language sql stable
set search_path = public, pg_temp
as $$
  select distinct s.subject from public.diagnostic_sessions s
   where s.profile_id = p_profile_id and s.status = 'done';
$$;

revoke all on function public.diagnostic_evidence_rows(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.diagnostic_done_subjects(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Черновой набор физики (заглушка до набора агента подборок, 14.10)
-- ─────────────────────────────────────────────────────────────────────────

select public.admin_diagnostic_set_load('physics', 'черновик-2026-10-14', '[{"n":1,"title":"Кинематика","tasks":{"лёгкая":[16635,16686,16636],"средняя":[92484,125782,92317]}},{"n":2,"title":"Динамика","tasks":{"лёгкая":[178287,186532,18526],"средняя":[141604,101845,136472],"сложная":[131184]}},{"n":3,"title":"Импульс. Законы сохранения","tasks":{"лёгкая":[102942,12841,117350],"средняя":[143766,127691,121636],"сложная":[136602]}},{"n":4,"title":"Статика. Гидростатика. Колебания","tasks":{"лёгкая":[13021,185904,97551],"средняя":[138674,114647,136671]}},{"n":5,"title":"Механика: анализ процессов","tasks":{"средняя":[120461,102987,136145],"сложная":[138677,138680,121340]}},{"n":6,"title":"Механика: изменение величин","tasks":{"лёгкая":[27092,165529,178842],"средняя":[139065,168643,95948],"сложная":[134163,136191]}},{"n":7,"title":"Молекулярная физика","tasks":{"лёгкая":[96666,94352,94463],"средняя":[91691,158781,96093],"сложная":[140671,143878,22574]}},{"n":8,"title":"Термодинамика","tasks":{"лёгкая":[91450,103362,155750],"средняя":[11233,92491,94933]}},{"n":9,"title":"МКТ и термодинамика: анализ процессов","tasks":{"средняя":[12487,12491,97745],"сложная":[100661,64984,103100]}},{"n":10,"title":"МКТ и термодинамика: изменение величин","tasks":{"лёгкая":[40925,14076,103105],"средняя":[14062,130527,26305],"сложная":[139119,136569,146773]}},{"n":11,"title":"Электрическое поле. Постоянный ток","tasks":{"лёгкая":[91693,94215,91769],"средняя":[133172,139170,139172],"сложная":[138773,138769]}},{"n":12,"title":"Магнитное поле. Индукция","tasks":{"лёгкая":[117204,114714,12771],"средняя":[12778,95161,132877],"сложная":[139129]}},{"n":13,"title":"Оптика. Электромагнитные колебания","tasks":{"лёгкая":[138167,138166,96188],"средняя":[136198,138561,65075]}},{"n":14,"title":"Электродинамика: анализ процессов","tasks":{"средняя":[15981,93787,143464],"сложная":[135537,136885,136979]}},{"n":15,"title":"Электродинамика: изменение величин","tasks":{"лёгкая":[166462,129319,11979],"средняя":[65077,102642,103248],"сложная":[139666,141193,140718]}},{"n":16,"title":"Квантовая физика","tasks":{"лёгкая":[96192,155765,155625],"средняя":[102434,96925,137155],"сложная":[22870,22866,18051]}},{"n":17,"title":"Квантовая физика: изменение величин","tasks":{"лёгкая":[84729,65221,155766],"средняя":[13711,13712,130457],"сложная":[22876,22878,22877]}},{"n":18,"title":"Выбор верных утверждений","tasks":{"средняя":[18653,84921,18650]}},{"n":19,"title":"Показания приборов","tasks":{"средняя":[59026,163393,163475]}},{"n":20,"title":"Планирование эксперимента","tasks":{"лёгкая":[137290,114763,137289],"средняя":[166334,117369,96876]}}]'::jsonb, true);
