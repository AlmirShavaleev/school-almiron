-- §286 — нагрузка главной ученика (разбор после пика 10.10: таймауты 8–14 с).
-- ПРЕДЛОЖЕНИЕ. Меняет существующие функции и таблицу catalog_tasks — по правилу
-- владельца запускается им в SQL Editor, в спокойное время, по частям A → B → C.
--
-- Замеры (прод, только чтение, ученик dd39511c, тихое время 11.10):
--   student_weak_numbers(physics)   641 мс (холодный 2 043 мс); math 3 318 мс
--     из них catalog_task_checkable на каждую задачу: 552 мс на 2 775 задач физики
--     (IMMUTABLE, но с SET search_path — не встраивается; разбирает answer_html
--     широкой таблицы, 67 МБ heap). Без неё та же выборка — 95 мс.
--   topic_done_events() целиком      108 мс (CTE tg считает признаки ВСЕХ 1 745 тем);
--     вызывается из student_home_activity и student_achievement_progress (255 мс) на
--     каждой загрузке главной, а нужен один ученик.
-- В пик эти секунды умножаются на одновременных учеников — отсюда 8–14 с.

-- ─────────────────────────────────────────────────────────────────────────
-- A. Готовая «проверяемость» задачи каталога
--    Столбец без значения по умолчанию добавляется мгновенно (без перезаписи
--    таблицы). Пока не заполнен — функции берут старый расчёт (coalesce).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.catalog_tasks add column if not exists auto_checkable boolean;

create or replace function public.catalog_tasks_auto_checkable_sync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.auto_checkable := public.catalog_task_checkable(new.exam_part, new.answer_html, new.partial_type);
  return new;
end $$;

drop trigger if exists catalog_tasks_auto_checkable on public.catalog_tasks;
create trigger catalog_tasks_auto_checkable
  before insert or update of exam_part, answer_html, partial_type on public.catalog_tasks
  for each row execute function public.catalog_tasks_auto_checkable_sync();

-- Заполнение — ОТДЕЛЬНО, пачками (22 тыс. строк), можно повторять до «0 rows»:
--   update public.catalog_tasks t
--      set auto_checkable = public.catalog_task_checkable(t.exam_part, t.answer_html, t.partial_type)
--    where t.id in (select id from public.catalog_tasks where auto_checkable is null limit 2000);

create index if not exists catalog_tasks_checkable_section_idx
  on public.catalog_tasks (section_id) where is_published and auto_checkable;

-- Выборки «какие задачи проверяемы» в двух функциях главной — через столбец.
-- Тела меняются заменой ровно одной подстроки; если её нет — ошибка, ничего не
-- меняется (защита от расхождения с продом).
do $patch$
declare
  f     text;
  d     text;
  v_old constant text := 'public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type)';
  v_new constant text := 'coalesce(ct.auto_checkable, public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type))';
begin
  foreach f in array array['public.student_weak_numbers(uuid,text)', 'public.student_daily_task(text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(v_old in d) = 0 then
      raise exception '§286 A: в % нет ожидаемой подстроки — тело на проде изменилось, сверить вручную', f;
    end if;
    execute replace(d, v_old, v_new);
  end loop;
end $patch$;

-- ─────────────────────────────────────────────────────────────────────────
-- B. «Тема пройдена» для выбранных учеников
--    Определение одно (CLAUDE.md: меняется только вместе с topicProgress.ts):
--    тело — прежнее, добавлен фильтр p_student_ids (null = все) в кандидатов и
--    «признаки темы» только по темам кандидатов. Прежняя функция без параметров
--    вызывает новую — второй копии логики нет.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.topic_done_events(p_student_ids uuid[])
returns table(student_id uuid, topic_id uuid, done_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  with
  -- Кандидаты — те, кто хоть что-то сделал по теме. Принятой работой тоже:
  -- тема, у которой есть только группа ДЗ, отметок не имеет вовсе, и по одним
  -- отметкам такая пара потерялась бы. Задачи к уроку — тот же случай.
  cand as (
    select m.student_id, m.topic_id from public.topic_section_marks m
     where p_student_ids is null or m.student_id = any (p_student_ids)
    union
    select a.student_id, h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.status = 'accepted'
       and (p_student_ids is null or a.student_id = any (p_student_ids))
    union
    select tvsa.student_id, tva.topic_id
      from public.test_variant_answers ans
      join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
      join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tva.topic_id is not null
       and (p_student_ids is null or tvsa.student_id = any (p_student_ids))
  ),
  task_totals as (
    select v.topic_id, count(tvi.id) as n
      from public.test_variants v
      join public.test_variant_items tvi on tvi.variant_id = v.id
     where v.topic_id is not null
       and v.topic_id in (select c.topic_id from cand c)
     group by v.topic_id
  ),
  tg as (
    select t.id as topic_id,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and (mi.kind = 'video' or mi.section in ('notes', 'theory'))
           and mi.track = 'ege'
      ) as has_theory,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and mi.section in ('tasks', 'task_solution', 'worksheet_tasks')
           and mi.track = 'ege'
      ) as has_lesson,
      (
        exists (select 1 from public.topic_homework h where h.topic_id = t.id)
        or exists (
          select 1 from public.topic_material_items mi
           where mi.topic_id = t.id
             and mi.section in ('worksheet_homework', 'solution')
             and mi.track = 'ege'
        )
      ) as has_homework,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) > 0 as has_tasks,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) as tasks_total
    from public.topics t
   where t.id in (select c.topic_id from cand c)
  ),
  ev as (
    select c.student_id, c.topic_id,
           tg.has_theory, tg.has_lesson, tg.has_homework, tg.has_tasks, tg.tasks_total,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'theory') as theory_at,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'lesson') as lesson_at,
           (select max(r.created_at) from public.topic_homework_reviews r
              join public.topic_homework_attempts a on a.id = r.attempt_id
              join public.topic_homework h on h.id = a.homework_id
             where a.student_id = c.student_id and h.topic_id = c.topic_id
               and a.status = 'accepted' and r.decision = 'accepted') as hw_at,
           -- Момент закрытия ПОСЛЕДНЕЙ задачи, и только если закрыты все.
           (select case
                     when count(*) filter (where ans.closed_by is not null) >= tg.tasks_total
                          and tg.tasks_total > 0
                     then max(ans.last_changed_at) filter (where ans.closed_by is not null)
                   end
              from public.test_variant_answers ans
              join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
              join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
             where tva.topic_id = c.topic_id
               and tvsa.student_id = c.student_id) as tasks_at
      from cand c
      join tg on tg.topic_id = c.topic_id
  )
  select ev.student_id, ev.topic_id,
         -- День, когда тема стала пройденной, — момент ПОСЛЕДНЕГО из нужных
         -- событий. Ненужные группы обнуляются явно: случайная отметка по
         -- группе, которой у темы нет, не должна двигать дату вперёд.
         greatest(
           case when ev.has_theory   then ev.theory_at end,
           case when ev.has_lesson   then ev.lesson_at end,
           case when ev.has_homework then ev.hw_at     end,
           case when ev.has_tasks    then ev.tasks_at  end
         ) as done_at
    from ev
   where (ev.has_theory or ev.has_lesson or ev.has_homework or ev.has_tasks)
     and (not ev.has_theory   or ev.theory_at is not null)
     and (not ev.has_lesson   or ev.lesson_at is not null)
     and (not ev.has_homework or ev.hw_at     is not null)
     and (not ev.has_tasks    or ev.tasks_at  is not null);
$$;

-- Прежняя сигнатура — для всех учеников, тем же телом.
create or replace function public.topic_done_events()
returns table(student_id uuid, topic_id uuid, done_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select * from public.topic_done_events(null::uuid[]);
$$;

-- Права — как у прежней на проде: authenticated и service_role, без anon.
revoke all on function public.topic_done_events(uuid[]) from public, anon;
grant execute on function public.topic_done_events(uuid[]) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- C. Главная ученика: «пройденные темы» — только свои
-- ─────────────────────────────────────────────────────────────────────────

-- Замена по шаблону с \s+ — не зависит от отступов и переводов строк (CRLF).
do $patch$
declare
  f     text;
  d     text;
  v_re  constant text := 'from public\.topic_done_events\(\) e(\s+)where e\.student_id in \(select id from st\)';
  v_new constant text := 'from public.topic_done_events(array(select id from st)) e\1where e.student_id in (select id from st)';
begin
  foreach f in array array['public.student_home_activity(integer)', 'public.student_achievement_progress(uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if d !~ v_re then
      raise exception '§286 C: в % нет ожидаемого вызова topic_done_events() — сверить вручную', f;
    end if;
    execute regexp_replace(d, v_re, v_new);
  end loop;
end $patch$;
