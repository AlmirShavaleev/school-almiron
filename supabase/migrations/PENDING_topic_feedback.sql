-- Опрос о качестве урока (письмо ЛК_стиль_урок_опрос_качества.md, 16.10).
-- НЕ ПРИМЕНЕНО. Применяет оркестратор после «да» владельца; имя файла — по версии в schema_migrations.
-- Только добавляющая: новая таблица и три новые функции; topic_ratings (§271) не трогается.
-- Повторный прогон — без ошибок (if not exists / create or replace).
--
-- Зачем. Владелец переделывает теорию, задачи и видео. Оценка 1–10 (§271) говорит «урок плохой», опрос — какой
-- именно материал (теория / видео / задачи / ДЗ) и где ученик застрял. Ответы читает агент-методист (CSV со вкладки
-- «Качество уроков»).
--
-- Где живёт. `topic_feedback` — одна строка на пару «тема × ученик» (unique), ответы можно менять («Изменить»).
-- Все ответы необязательные (null — не ответил). Варианты — короткие коды, их значения проверяет check:
--   clarity            full | mostly | partly | no                    — «Понятна ли тема после теории и видео?»
--   video              full | partly | none                           — «Видео»
--   video_pace         slow | ok | fast                               — темп (только если смотрел)
--   lesson_difficulty  easy | ok | hard                               — «Задачи урока по сложности»
--   hw_self            all | most | few | none                        — «Сколько задач ДЗ решил сам»
--   hard_spots         text[] из theory | video | lesson_task | hw_task | examples | picture | nothing
--   hard_lesson_task, hard_hw_task — номера задач (строка до 40 символов: «3», «3, 5»)
--   found_error        bool; error_where theory | tasks | solutions | video; error_task, error_text
--   time_spent         lt30 | 30_60 | 1_2h | gt2h
--   improve            свободный текст
--
-- Кто пишет. Только `save_topic_feedback` (definer). Ученик — `auth_student_id()`; доступ к теме — тот же помощник,
-- что у оценки (`course_student_can_see_topic`). Не ученик / чужая или закрытая тема → 42501. Неизвестный код ответа →
-- 23514 (check), слишком длинный текст → 22001.
--
-- Кто читает. Ученик — только свои ответы (`my_topic_feedback`). Персонал курса (`course_is_staff`) — все ответы по
-- темам курса (`topic_feedback_for_course`) с именем ученика: список найденных ошибок по письму идёт «со ссылкой на
-- ученика». У каркаса (courses.is_template) — ответы темы каркаса и всех её копий в классах под id темы каркаса
-- («общая копилка», как оценки в §276).
--
-- Таблица закрыта целиком: RLS включена, политик нет, прав у anon/authenticated нет — только definer-функции
-- (как topic_ratings §271, school_presence §148).
--
-- Порядок выкладки: миграция → фронт (без миграции плашка опроса и вкладка «Качество уроков» показывают ошибку
-- загрузки; остальное на странице урока работает).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Таблица
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.topic_feedback (
  id                 uuid primary key default gen_random_uuid(),
  topic_id           uuid not null references public.topics(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  clarity            text check (clarity in ('full', 'mostly', 'partly', 'no')),
  video              text check (video in ('full', 'partly', 'none')),
  video_pace         text check (video_pace in ('slow', 'ok', 'fast')),
  lesson_difficulty  text check (lesson_difficulty in ('easy', 'ok', 'hard')),
  hw_self            text check (hw_self in ('all', 'most', 'few', 'none')),
  hard_spots         text[] not null default '{}'
                     check (hard_spots <@ array['theory', 'video', 'lesson_task', 'hw_task', 'examples', 'picture', 'nothing']::text[]),
  hard_lesson_task   varchar(40),
  hard_hw_task       varchar(40),
  found_error        boolean,
  error_where        text check (error_where in ('theory', 'tasks', 'solutions', 'video')),
  error_task         varchar(40),
  error_text         varchar(2000),
  time_spent         text check (time_spent in ('lt30', '30_60', '1_2h', 'gt2h')),
  improve            varchar(2000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (topic_id, student_id)
);

create index if not exists topic_feedback_topic_id_idx on public.topic_feedback (topic_id);
-- Удаление ученика каскадом ищет его строки — без индекса это полный проход.
create index if not exists topic_feedback_student_id_idx on public.topic_feedback (student_id);

alter table public.topic_feedback enable row level security;
revoke all on table public.topic_feedback from public, anon, authenticated;

comment on table public.topic_feedback is
  'Опрос о качестве урока (16.10): одна строка на пару тема × ученик, менять можно. Закрыта целиком: пишет save_topic_feedback, читают my_topic_feedback (свои) и topic_feedback_for_course (персонал курса).';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Сохранить / изменить ответы
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.save_topic_feedback(p_topic_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_at      timestamptz;
  a         jsonb := coalesce(p_answers, '{}'::jsonb);
begin
  v_student := public.auth_student_id();
  if v_student is null then
    raise exception 'Опрос по уроку проходит ученик' using errcode = '42501';
  end if;

  if p_topic_id is null or not public.course_student_can_see_topic(p_topic_id) then
    raise exception 'Нет доступа к этому уроку' using errcode = '42501';
  end if;

  insert into public.topic_feedback as f (
    topic_id, student_id, clarity, video, video_pace, lesson_difficulty, hw_self,
    hard_spots, hard_lesson_task, hard_hw_task, found_error, error_where, error_task, error_text,
    time_spent, improve
  )
  values (
    p_topic_id, v_student,
    nullif(a->>'clarity', ''), nullif(a->>'video', ''), nullif(a->>'video_pace', ''),
    nullif(a->>'lesson_difficulty', ''), nullif(a->>'hw_self', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(a->'hard_spots', '[]'::jsonb))), '{}'),
    nullif(btrim(a->>'hard_lesson_task'), ''), nullif(btrim(a->>'hard_hw_task'), ''),
    (a->>'found_error')::boolean, nullif(a->>'error_where', ''),
    nullif(btrim(a->>'error_task'), ''), nullif(btrim(a->>'error_text'), ''),
    nullif(a->>'time_spent', ''), nullif(btrim(a->>'improve'), '')
  )
  on conflict (topic_id, student_id) do update
    set clarity           = excluded.clarity,
        video             = excluded.video,
        video_pace        = excluded.video_pace,
        lesson_difficulty = excluded.lesson_difficulty,
        hw_self           = excluded.hw_self,
        hard_spots        = excluded.hard_spots,
        hard_lesson_task  = excluded.hard_lesson_task,
        hard_hw_task      = excluded.hard_hw_task,
        found_error       = excluded.found_error,
        error_where       = excluded.error_where,
        error_task        = excluded.error_task,
        error_text        = excluded.error_text,
        time_spent        = excluded.time_spent,
        improve           = excluded.improve,
        updated_at        = now()
  returning f.updated_at into v_at;

  return jsonb_build_object('updated_at', v_at);
end;
$$;

comment on function public.save_topic_feedback(uuid, jsonb) is
  'Опрос о качестве урока: ученик сохраняет или меняет свои ответы (upsert, все поля необязательны). Доступ — course_student_can_see_topic, иначе 42501; не ученик — 42501. Возвращает {updated_at}.';

revoke all on function public.save_topic_feedback(uuid, jsonb) from public, anon;
grant execute on function public.save_topic_feedback(uuid, jsonb) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Свои ответы
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.my_topic_feedback(p_topic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(f) - 'id' - 'student_id' - 'topic_id' - 'created_at'
    from public.topic_feedback f
   where f.topic_id = p_topic_id
     and f.student_id = public.auth_student_id();
$$;

comment on function public.my_topic_feedback(uuid) is
  'Опрос о качестве урока: ответы вызывающего ученика по теме (jsonb) или null — ещё не проходил / не ученик. Только своя строка.';

revoke all on function public.my_topic_feedback(uuid) from public, anon;
grant execute on function public.my_topic_feedback(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Ответы по курсу для персонала («Качество уроков»)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.topic_feedback_for_course(p_course_id uuid)
returns table (
  topic_id uuid, student_id uuid, student_name text,
  clarity text, video text, video_pace text, lesson_difficulty text, hw_self text,
  hard_spots text[], hard_lesson_task text, hard_hw_task text,
  found_error boolean, error_where text, error_task text, error_text text,
  time_spent text, improve text, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_template boolean;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к опросам по урокам этого курса' using errcode = '42501';
  end if;

  select c.is_template into v_template from public.courses c where c.id = p_course_id;

  return query
  with course_topics as (
    select t.id
      from public.topics  t
      join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  )
  select case when ft.id in (select id from course_topics) then ft.id else ft.source_topic_id end,
         f.student_id,
         p.full_name::text,
         f.clarity, f.video, f.video_pace, f.lesson_difficulty, f.hw_self,
         f.hard_spots, f.hard_lesson_task::text, f.hard_hw_task::text,
         f.found_error, f.error_where, f.error_task::text, f.error_text::text,
         f.time_spent, f.improve::text, f.updated_at
    from public.topic_feedback f
    join public.topics   ft on ft.id = f.topic_id
    join public.students s  on s.id  = f.student_id
    left join public.profiles p on p.id = s.profile_id
   where ft.id in (select id from course_topics)
      or (coalesce(v_template, false) and ft.source_topic_id in (select id from course_topics))
   order by f.updated_at desc;
end;
$$;

comment on function public.topic_feedback_for_course(uuid) is
  'Опрос о качестве урока: все ответы по темам курса для персонала (course_is_staff, иначе 42501), с именем ученика. У каркаса (is_template) — ответы темы каркаса и всех её копий в классах под id темы каркаса (как §276).';

revoke all on function public.topic_feedback_for_course(uuid) from public, anon;
grant execute on function public.topic_feedback_for_course(uuid) to authenticated;
