-- §222b. Пробник, этап Б: ИИ предлагает баллы за вторую часть, преподаватель принимает.
--
-- Только добавляющая: три новые таблицы, одна новая функция, политики на новых
-- таблицах. Существующие таблицы, функции и политики не тронуты. Повторный
-- прогон — без ошибок и без изменений (проба в supabase/tests/ii_probnik_222b/run.sh).
--
-- Как устроено (родня: §32–§48 ИИ-проверка ДЗ, §218/§221/§229/§231 права пробника):
--   * Кнопку «Проверить ИИ» жмёт преподаватель. Клиент зовёт edge-функцию
--     check-mock-exam-ai с JWT; функция первым делом зовёт ОТ ИМЕНИ
--     ПОЛЬЗОВАТЕЛЯ mock_exam_ai_request_check — права проверяет база, — и
--     дальше работает сервисным ключом: фото ученика, решение и критерии его
--     варианта, запрос к модели, запись предложений и статуса.
--   * ИИ НИКОГДА не пишет в mock_exam_task_scores. Его предложение лежит в
--     mock_exam_ai_suggestions; балл в клетку ставит человек кнопкой «Принять»
--     и сохраняет обычным путём (save_mock_exam_grid). Так же, как в ДЗ: ИИ
--     готовит черновик, вердикт за человеком.
--   * Ученик не видит ничего: ни политики на чтение, ни функции для него нет.
--
-- Права — правило соседних таблиц пробника, своего не изобретаем:
--   читать  — админ платформы или персонал курса группы пробника
--             (mock_exam_is_staff: владелец курса, преподаватель группы,
--             куратор группы/курса);
--   писать  — тот же персонал с ролью teacher или админ (mock_exam_can_manage,
--             §221); куратор читает, но не управляет — как у баллов (§231).
--   Запустить проверку — тоже mock_exam_can_manage: принять предложение
--   куратор всё равно не может (save_mock_exam_grid ему откажет).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Предложения ИИ по номерам второй части
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.mock_exam_ai_suggestions (
  id           uuid primary key default gen_random_uuid(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  task_number  integer not null check (task_number between 1 and 60),
  points       integer not null check (points >= 0),
  -- Максимум номера по шаблону НА МОМЕНТ проверки: если шаблон потом
  -- поправят, экран увидит расхождение и не даст принять балл больше нового
  -- максимума (клиент сверяет с шаблоном, база — триггером task_scores).
  max_points   integer not null check (max_points between 0 and 20),
  confidence   text not null check (confidence in ('high', 'medium', 'low')),
  -- Что не так / за что снижено — по-русски, коротко. Для преподавателя.
  comment      text check (comment is null or length(comment) <= 1000),
  -- Рамки на фото: [{photo_id, page, x, y, w, h}], координаты — доли
  -- страницы 0..1 от левого верхнего угла (как у ИИ-проверки ДЗ). page — номер
  -- страницы PDF (у фотографии 1).
  regions      jsonb not null default '[]'::jsonb check (jsonb_typeof(regions) = 'array'),
  model        text,
  created_at   timestamptz not null default now(),
  constraint mock_exam_ai_suggestions_points_max check (points <= max_points),
  constraint mock_exam_ai_suggestions_unique unique (mock_exam_id, student_id, task_number)
);

comment on table public.mock_exam_ai_suggestions is
  '§222b. Предложение ИИ: балл за номер второй части пробника, уверенность, комментарий и рамки на фото. Черновик для преподавателя: в mock_exam_task_scores балл попадает только кнопкой «Принять» и сохранением save_mock_exam_grid. Пишет edge-функция check-mock-exam-ai сервисным ключом. Ученику недоступно никогда.';

create index if not exists mock_exam_ai_suggestions_student_idx on public.mock_exam_ai_suggestions (student_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Состояние запуска на пару (пробник, ученик)
-- ──────────────────────────────────────────────────────────────────────────
-- Одна строка на пару, а не журнал задач, как в ДЗ: у пробника одна работа на
-- ученика, история прогонов экрану не нужна — нужен ответ «идёт / готово /
-- ошибка и почему».
create table if not exists public.mock_exam_ai_runs (
  mock_exam_id  uuid not null references public.mock_exams(id) on delete cascade,
  student_id    uuid not null references public.students(id)   on delete cascade,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  -- Причина ошибки — только отсюда преподаватель узнает, что чинить.
  last_error    text check (last_error is null or length(last_error) <= 1000),
  -- Приписки к удачному прогону: проверено без решения, фото не все и т. п.
  note          text check (note is null or length(note) <= 2000),
  model         text,
  requested_by  uuid references public.profiles(id) on delete set null,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  input_tokens  integer,
  output_tokens integer,
  primary key (mock_exam_id, student_id)
);

comment on table public.mock_exam_ai_runs is
  '§222b. Состояние ИИ-проверки второй части у ученика: queued → running → done | error. Ставит в очередь mock_exam_ai_request_check (права — mock_exam_can_manage), ведёт edge-функция check-mock-exam-ai. Зависшее дольше 10 минут сторож в той же функции закрывает ошибкой. Ученику недоступно.';

create index if not exists mock_exam_ai_runs_student_idx on public.mock_exam_ai_runs (student_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Кэш разобранного текста PDF решений и критериев
-- ──────────────────────────────────────────────────────────────────────────
-- Как topic_material_text_cache (§137), но по пути файла в бакете mock-exams:
-- строк материалов у пробника нет. Файл заменили — путь новый (форма кладёт
-- с префиксом-счётчиком); для надёжности сверяется ещё и размер. Только
-- сервисному ключу: ни политик, ни прав у authenticated.
create table if not exists public.mock_exam_file_text_cache (
  storage_path text primary key,
  size_bytes   bigint not null,
  engine       text,
  text         text not null,
  chars        integer,
  created_at   timestamptz not null default now()
);

comment on table public.mock_exam_file_text_cache is
  '§222b. Распознанный текст PDF пробника (решение, критерии) для промпта ИИ-проверки. Ключ — путь в бакете mock-exams, сверка по размеру. Только сервисный ключ.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────────
alter table public.mock_exam_ai_suggestions   enable row level security;
alter table public.mock_exam_ai_runs          enable row level security;
alter table public.mock_exam_file_text_cache  enable row level security;

revoke all on public.mock_exam_ai_suggestions  from anon;
revoke all on public.mock_exam_ai_runs         from anon;
revoke all on public.mock_exam_file_text_cache from anon, authenticated;

grant select, insert, update, delete on public.mock_exam_ai_suggestions to authenticated;
-- Состояние запуска клиент только читает: в очередь ставит definer-функция,
-- дальше ведёт сервисный ключ.
grant select on public.mock_exam_ai_runs to authenticated;
revoke insert, update, delete, truncate on public.mock_exam_ai_runs from authenticated;

-- Политики — без `drop policy if exists`: таблицы новые, а apply_migration на
-- проде зависал на drop … if exists (§266). Повторный прогон — по pg_policies.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mock_exam_ai_suggestions' and policyname = 'mock_exam_ai_suggestions_staff_select') then
    create policy mock_exam_ai_suggestions_staff_select on public.mock_exam_ai_suggestions
      for select to authenticated
      using ((select public.is_admin_or_owner()) or (select public.mock_exam_is_staff(mock_exam_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mock_exam_ai_suggestions' and policyname = 'mock_exam_ai_suggestions_manage_insert') then
    create policy mock_exam_ai_suggestions_manage_insert on public.mock_exam_ai_suggestions
      for insert to authenticated
      with check ((select public.mock_exam_can_manage(mock_exam_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mock_exam_ai_suggestions' and policyname = 'mock_exam_ai_suggestions_manage_update') then
    create policy mock_exam_ai_suggestions_manage_update on public.mock_exam_ai_suggestions
      for update to authenticated
      using ((select public.mock_exam_can_manage(mock_exam_id)))
      with check ((select public.mock_exam_can_manage(mock_exam_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mock_exam_ai_suggestions' and policyname = 'mock_exam_ai_suggestions_manage_delete') then
    create policy mock_exam_ai_suggestions_manage_delete on public.mock_exam_ai_suggestions
      for delete to authenticated
      using ((select public.mock_exam_can_manage(mock_exam_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mock_exam_ai_runs' and policyname = 'mock_exam_ai_runs_staff_select') then
    create policy mock_exam_ai_runs_staff_select on public.mock_exam_ai_runs
      for select to authenticated
      using ((select public.is_admin_or_owner()) or (select public.mock_exam_is_staff(mock_exam_id)));
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Заявка на проверку — по образцу topic_homework_ai_request_check
-- ──────────────────────────────────────────────────────────────────────────
-- p_student_ids null — «у всех»: ученики группы с фото второй части, у кого
-- ещё нет ни одного предложения и не идёт проверка. Список — только эти
-- ученики (кого нет в группе — 'not_in_group').
--
-- Возвращает jsonb-массив [{student_id, outcome}], outcome:
--   queued         — поставлен в очередь (или уже стоял в ней): функция его проверит;
--   running        — проверка уже идёт, второй раз не ставим;
--   no_photos      — фото второй части нет, проверять нечего;
--   has_suggestions — (только «у всех») предложения уже есть;
--   not_in_group   — ученика нет в группе пробника.
--
-- Сторож (как topic_homework_ai_expire_stale_jobs): строка в queued/running
-- дольше 10 минут мертва — потолок edge-функции по стене 400 с, а модель
-- ждём не дольше 125 с. Её закрываем ошибкой, иначе кнопка вечно «идёт».
create or replace function public.mock_exam_ai_request_check(
  p_mock_exam_id uuid,
  p_student_ids  uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_group    uuid;
  v_template uuid;
  v_out      jsonb := '[]'::jsonb;
  v_sid      uuid;
  v_outcome  text;
  v_status   text;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти' using errcode = '42501';
  end if;
  -- Админ платформы — и у пробника без группы (mock_exam_can_manage для него
  -- ложна: персонала курса нет); дальше ему всё равно откажет «нет группы».
  if not (public.is_admin_or_owner() or public.mock_exam_can_manage(p_mock_exam_id)) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  if p_student_ids is not null and coalesce(array_length(p_student_ids, 1), 0) > 200 then
    raise exception 'Слишком много учеников за один раз' using errcode = '22023';
  end if;

  select me.group_id, me.template_id into v_group, v_template
    from public.mock_exams me where me.id = p_mock_exam_id;
  if v_group is null then
    raise exception 'У пробника нет группы — проверять некого' using errcode = '22023';
  end if;
  if v_template is null then
    raise exception 'У пробника нет шаблона — номеров второй части нет' using errcode = '22023';
  end if;

  update public.mock_exam_ai_runs r
     set status = 'error',
         finished_at = now(),
         last_error = coalesce(r.last_error,
           'Проверка оборвалась, результата не будет: функция не ответила за 10 минут. Запустите проверку заново.')
   where r.mock_exam_id = p_mock_exam_id
     and r.status in ('queued', 'running')
     and coalesce(r.started_at, r.requested_at) < now() - interval '10 minutes';

  for v_sid in
    select coalesce(gs.student_id, ids.sid)
      from (select distinct unnest(p_student_ids) as sid) ids
      full join (select g.student_id from public.group_students g where g.group_id = v_group) gs
        on gs.student_id = ids.sid
     where p_student_ids is null or ids.sid is not null
     order by 1
  loop
    if not exists (select 1 from public.group_students g where g.group_id = v_group and g.student_id = v_sid) then
      v_outcome := 'not_in_group';
    elsif not exists (select 1 from public.mock_exam_photos p where p.mock_exam_id = p_mock_exam_id and p.student_id = v_sid) then
      v_outcome := 'no_photos';
    else
      select r.status into v_status from public.mock_exam_ai_runs r
       where r.mock_exam_id = p_mock_exam_id and r.student_id = v_sid;
      if v_status = 'running' then
        v_outcome := 'running';
      elsif p_student_ids is null and exists (
        select 1 from public.mock_exam_ai_suggestions s where s.mock_exam_id = p_mock_exam_id and s.student_id = v_sid
      ) then
        v_outcome := 'has_suggestions';
      else
        insert into public.mock_exam_ai_runs as r (mock_exam_id, student_id, status, requested_by, requested_at)
        values (p_mock_exam_id, v_sid, 'queued', auth.uid(), now())
        on conflict (mock_exam_id, student_id) do update
          set status = 'queued', requested_by = excluded.requested_by, requested_at = excluded.requested_at,
              last_error = null, note = null, started_at = null, finished_at = null;
        v_outcome := 'queued';
      end if;
    end if;
    -- «У всех» отдаёт только тех, кого касается: чужих и пустых не перечисляет.
    if p_student_ids is not null or v_outcome in ('queued', 'running') then
      v_out := v_out || jsonb_build_object('student_id', v_sid, 'outcome', v_outcome);
    end if;
  end loop;

  return v_out;
end $$;

comment on function public.mock_exam_ai_request_check(uuid, uuid[]) is
  '§222b. Заявка на ИИ-проверку второй части пробника: права (админ или mock_exam_can_manage), сторож зависших, постановка в очередь. Возвращает [{student_id, outcome}] — queued | running | no_photos | has_suggestions | not_in_group. Зовёт edge-функция check-mock-exam-ai от имени преподавателя (и экран — чтобы статус «в очереди» появился сразу).';

revoke all on function public.mock_exam_ai_request_check(uuid, uuid[]) from public, anon;
grant execute on function public.mock_exam_ai_request_check(uuid, uuid[]) to authenticated;
