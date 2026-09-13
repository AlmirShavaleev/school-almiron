-- «Тема пройдена»: задачи считаются по варианту-носителю (§164).
--
-- В §162 число задач темы бралось из выдачи. С ленивой выдачей это молча
-- врёт в опасную сторону: у темы, которую ученик ещё не открывал, выдачи нет,
-- значит `has_tasks` = false, значит тема засчитывается пройденной по одним
-- отметкам — с семью нерешёнными задачами. Источник числа задач теперь тот же,
-- что у экрана ученика и у экрана преподавателя: `test_variants.topic_id`.
--
-- Определение «тема пройдена» по-прежнему живёт ровно в двух местах — здесь и
-- в `topicDone` на клиенте, — и совпадение проверяется общим тестом (§162).
-- Само правило не менялось: сменился только источник числа задач.

CREATE OR REPLACE FUNCTION public.topic_done_events()
 RETURNS TABLE(student_id uuid, topic_id uuid, done_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with task_totals as (
    select v.topic_id, count(tvi.id) as n
      from public.test_variants v
      join public.test_variant_items tvi on tvi.variant_id = v.id
     where v.topic_id is not null
     group by v.topic_id
  ),
  tg as (
    select t.id as topic_id,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and (mi.kind = 'video' or mi.section in ('notes', 'theory'))
      ) as has_theory,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and mi.section in ('tasks', 'task_solution', 'worksheet_tasks')
      ) as has_lesson,
      (
        exists (select 1 from public.topic_homework h where h.topic_id = t.id)
        or exists (
          select 1 from public.topic_material_items mi
           where mi.topic_id = t.id
             and mi.section in ('worksheet_homework', 'solution')
        )
      ) as has_homework,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) > 0 as has_tasks,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) as tasks_total
    from public.topics t
  ),
  -- Кандидаты — те, кто хоть что-то сделал по теме. Принятой работой тоже:
  -- тема, у которой есть только группа ДЗ, отметок не имеет вовсе, и по одним
  -- отметкам такая пара потерялась бы. Задачи к уроку — тот же случай.
  cand as (
    select m.student_id, m.topic_id from public.topic_section_marks m
    union
    select a.student_id, h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.status = 'accepted'
    union
    select tvsa.student_id, tva.topic_id
      from public.test_variant_answers ans
      join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
      join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tva.topic_id is not null
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
$function$;

comment on function public.topic_done_events() is
  'Пары «ученик × пройденная тема» с датой. Задачи к уроку считаются по варианту-носителю темы. §152/§162/§164';
