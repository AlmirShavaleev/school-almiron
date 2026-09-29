-- §244. Страница «Курсы» у учителя: цифры по каждому курсу одним вызовом.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавление: одна новая функция. Таблицы, политики и существующие
-- функции не меняются. Повторное применение безопасно (create or replace).
--
-- ── Зачем в базе ───────────────────────────────────────────────────────────
-- Список курсов показывает по каждому курсу учеников, открытые темы, работы
-- на проверке, сдачи за неделю и ближайшее открытие по плану. Клиентом это
-- пять запросов на КАЖДЫЙ курс (N+1), причём ростер и попытки идут через
-- `!inner`-джойны, где политика молча выбрасывает строки (CLAUDE.md: «пустой
-- список — повод проверить права»). Одна definer-функция на весь экран.
--
-- ── Кто видит ──────────────────────────────────────────────────────────────
-- Строка отдаётся только по курсу, где вызывающий — персонал
-- (`course_is_staff`, одна формулировка проекта, своей копии нет). Ученику и
-- постороннему преподавателю — пустой результат (не ошибка: экран списка
-- курсов у них просто без цифр). Анониму execute отозван.
--
-- Владелец платформы (admin) — персонал любого курса, поэтому клиент передаёт
-- `p_course_ids` — ровно те курсы, что уже нарисованы на странице (в режиме
-- учителя это «свои», см. useCourseProgram / useMyTeachingScope), как у
-- `teacher_home` (§233). Чужой курс в списке ничего не открывает: пересечение
-- с `course_is_staff` остаётся. null — все курсы, где вызывающий персонал.
--
-- ── Определения ────────────────────────────────────────────────────────────
-- * students / student_ids — различные ученики групп курса (group_students;
--   один курс = одна группа, но считаем без этого допущения). Массив нужен
--   клиенту, чтобы в строке класса посчитать РАЗЛИЧНЫХ учеников по нескольким
--   курсам (ученик 11А на математике и физике — один ученик класса).
-- * topics / modules — все темы и модули курса.
-- * open_topics — темы, открытые ученикам сейчас: `topic_open_now` (правило
--   открытости живёт только там).
-- * pending — работы, ждущие проверки: попытки со статусом submitted по ДЗ
--   тем курса, любого типа темы (урок, проверочная, контрольная) — ровно то,
--   что считает вкладка «Ждут проверки» очереди `/homework-queue` (у работы не
--   бывает двух активных попыток — индекс topic_homework_attempts_one_active,
--   поэтому попытки = работы). Как и очередь, собственные сдачи вызывающего
--   (куратор, который сам где-то ученик) не считаются: сам себя не проверяют.
--   Ростером не сужаем — очередь тоже показывает сдачу ученика, которого уже
--   перевели из группы.
-- * subs_7d — сдачи за 7 дней: попытки не draft с submitted_at, день сдачи
--   по Москве — сегодня или шесть дней до (то же окно, что период '7d' в
--   статистике курса §242). Каждая пересдача — отдельная сдача. Отличие от
--   §242 намеренное и записано в PROJECT_STATE §244: там сдачи считаются
--   только по темам-урокам и только текущих учеников, здесь — все работы
--   курса, как очередь проверки.
-- * next_open — ближайшая дата открытия по плану: min(available_from) среди
--   тем с is_open IS NULL (тумблер не трогали — решает дата) и
--   available_from > current_date (как в `topic_open_now`, та же дата).
--   next_open_count — сколько тем курса откроется в этот день.

create or replace function public.teacher_courses_overview(p_course_ids uuid[] default null)
returns table (
  course_id       uuid,
  students        int,
  student_ids     uuid[],
  topics          int,
  open_topics     int,
  modules         int,
  pending         int,
  subs_7d         int,
  next_open       date,
  next_open_count int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  sc as (
    select c.id
      from public.courses c
     where (p_course_ids is null or c.id = any (p_course_ids))
       and public.course_is_staff(c.id)
  ),
  ro as (
    select g.course_id, array_agg(distinct gs.student_id order by gs.student_id) as ids
      from public.groups g
      join public.group_students gs on gs.group_id = g.id
     where g.course_id in (select id from sc)
     group by g.course_id
  ),
  md as (
    select m.course_id, count(*)::int as n
      from public.modules m
     where m.course_id in (select id from sc)
     group by m.course_id
  ),
  tp as (
    select m.course_id,
           count(*)::int as topics,
           count(*) filter (where public.topic_open_now(t.is_open, t.available_from))::int as open_topics,
           min(t.available_from) filter (where t.is_open is null and t.available_from > current_date) as next_open
      from public.topics t
      join public.modules m on m.id = t.module_id
     where m.course_id in (select id from sc)
     group by m.course_id
  ),
  nx as (
    select m.course_id, count(*)::int as n
      from public.topics t
      join public.modules m on m.id = t.module_id
      join tp on tp.course_id = m.course_id
     where t.is_open is null
       and t.available_from = tp.next_open
     group by m.course_id
  ),
  hw as (
    select m.course_id,
           count(*) filter (where a.status = 'submitted')::int as pending,
           count(*) filter (
             where a.status <> 'draft'
               and a.submitted_at is not null
               and (a.submitted_at at time zone 'Europe/Moscow')::date
                   >= (now() at time zone 'Europe/Moscow')::date - 6
           )::int as subs_7d
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
      join public.topics t  on t.id = h.topic_id
      join public.modules m on m.id = t.module_id
     where m.course_id in (select id from sc)
       and not exists (select 1 from public.students s
                        where s.id = a.student_id and s.profile_id = auth.uid())
     group by m.course_id
  )
  select sc.id,
         coalesce(cardinality(ro.ids), 0),
         coalesce(ro.ids, '{}'::uuid[]),
         coalesce(tp.topics, 0),
         coalesce(tp.open_topics, 0),
         coalesce(md.n, 0),
         coalesce(hw.pending, 0),
         coalesce(hw.subs_7d, 0),
         tp.next_open,
         coalesce(nx.n, 0)
    from sc
    left join ro on ro.course_id = sc.id
    left join md on md.course_id = sc.id
    left join tp on tp.course_id = sc.id
    left join nx on nx.course_id = sc.id
    left join hw on hw.course_id = sc.id;
$$;

comment on function public.teacher_courses_overview(uuid[]) is
  '§244. Страница «Курсы» у учителя одним вызовом: по каждому курсу, где вызывающий — персонал (course_is_staff), — ученики (число и id), темы, открытые сейчас (topic_open_now), модули, работы на проверке (submitted, как очередь), сдачи за 7 дней по Москве, ближайшее открытие по плану (is_open null, available_from > сегодня) и сколько тем откроется. p_course_ids сужает (админ в режиме учителя); ученику и постороннему — пусто.';

revoke all on function public.teacher_courses_overview(uuid[]) from public, anon;
grant execute on function public.teacher_courses_overview(uuid[]) to authenticated;
