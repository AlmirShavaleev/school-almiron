-- Журнал ученика по новому контуру: ДЗ темы (topic_homework) + тесты темы
-- (привязки банка). Заменяет в журнале блок Homework V2, который читал
-- легаси-ветку homework_templates (очередь 2 §4 PROJECT_STATE).
--
-- Читающая функция, ничего не пишет. SECURITY DEFINER — потому что она обходит
-- RLS и собирает данные по нескольким таблицам сразу; поэтому права проверяются
-- в теле явно, тем же правилом, что и в get_student_homework_journal:
-- сам ученик / admin|owner / преподаватель группы этого ученика.
--
-- Видимость тем: показываем только уже открытые (available_from <= сегодня) —
-- то же правило, что видит ученик в программе курса, чтобы журнал ученика и
-- журнал преподавателя не расходились.

create or replace function public.get_student_topic_journal(
  p_student_id uuid,
  p_course_id  uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_is_self  boolean;
  v_is_admin boolean;
  v_result   jsonb;
begin
  select exists (
    select 1 from students s where s.id = p_student_id and s.profile_id = auth.uid()
  ) into v_is_self;

  -- coalesce обязателен: без jwt get_my_role() отдаёт NULL, и `NULL in (...)`
  -- сделал бы всё условие ниже NULL — проверка молча не сработала бы.
  v_is_admin := coalesce(public.is_admin_or_owner(), false);
  v_is_self  := coalesce(v_is_self, false);

  if not coalesce(
    v_is_self
    or v_is_admin
    or exists (
      select 1 from group_students gs
       where gs.student_id = p_student_id
         and public.auth_is_teacher_of_group(gs.group_id)
    ), false)
  then
    return null;
  end if;

  with scope as (
    -- Курсы ученика, которые вправе видеть вызывающий.
    select distinct g.course_id
      from group_students gs
      join groups g on g.id = gs.group_id
     where gs.student_id = p_student_id
       and g.course_id is not null
       and (p_course_id is null or g.course_id = p_course_id)
       and (v_is_self or v_is_admin or public.auth_is_teacher_of_group(g.id))
  ),
  visible_topics as (
    select t.id as topic_id, t.title as topic_title, t.order_index,
           m.title as module_title, m.course_id, c.title as course_title
      from topics t
      join modules m on m.id = t.module_id
      join scope   s on s.course_id = m.course_id
      join courses c on c.id = m.course_id
     where t.available_from is null or t.available_from <= current_date
  ),
  hw_rows as (
    select
      vt.topic_id,
      vt.topic_title,
      vt.module_title,
      vt.course_id,
      vt.course_title,
      vt.order_index,
      h.id     as homework_id,
      h.title  as title,
      h.due_at,
      h.grade_scale,
      -- Принятая попытка терминальна (пересдача запрещена триггером), поэтому
      -- она и определяет статус; иначе берём самую свежую.
      case
        when a.id is null then 'not_started'
        when a.status = 'accepted' then 'accepted'
        when a.status = 'submitted' then 'submitted'
        when a.status = 'returned_for_revision' then 'returned'
        else 'draft'
      end as status,
      r.score,
      r.comment,
      a.submitted_at,
      r.created_at as reviewed_at,
      coalesce(ac.cnt, 0) as attempts_count,
      (h.due_at is not null
        and h.due_at < current_date
        and (a.id is null or a.status in ('draft', 'returned_for_revision'))) as is_overdue
    from visible_topics vt
    join topic_homework h on h.topic_id = vt.topic_id and h.is_published
    left join lateral (
      select a.*
        from topic_homework_attempts a
       where a.homework_id = h.id and a.student_id = p_student_id
       order by (a.status = 'accepted') desc, a.attempt_number desc
       limit 1
    ) a on true
    left join lateral (
      select r.*
        from topic_homework_reviews r
       where r.attempt_id = a.id
       order by r.created_at desc
       limit 1
    ) r on true
    left join lateral (
      select count(*) as cnt
        from topic_homework_attempts aa
       where aa.homework_id = h.id and aa.student_id = p_student_id
    ) ac on true
  ),
  test_rows as (
    select
      vt.topic_id,
      vt.topic_title,
      vt.course_id,
      vt.course_title,
      vt.order_index,
      ta.id      as assignment_id,
      ta.test_id,
      tt.title   as test_title,
      case
        when att.id is null then 'not_started'
        when att.status = 'completed' then 'completed'
        else 'in_progress'
      end as status,
      att.total_points,
      att.max_points,
      case
        when att.status = 'completed' and coalesce(att.max_points, 0) > 0
          then round(att.total_points::numeric * 100 / att.max_points)
        else null
      end as percent,
      att.started_at,
      att.completed_at
    from visible_topics vt
    join topic_test_assignments ta on ta.topic_id = vt.topic_id
    join topic_tests tt on tt.id = ta.test_id
    left join topic_test_attempts att
           on att.assignment_id = ta.id and att.student_id = p_student_id
  )
  select jsonb_build_object(
    'homework', coalesce((
      select jsonb_agg(to_jsonb(h) - 'order_index' order by h.due_at nulls last, h.order_index)
        from hw_rows h), '[]'::jsonb),
    'tests', coalesce((
      select jsonb_agg(to_jsonb(t) - 'order_index' order by t.order_index)
        from test_rows t), '[]'::jsonb),
    'summary', jsonb_build_object(
      'hw_total',        (select count(*) from hw_rows),
      'hw_accepted',     (select count(*) from hw_rows where status = 'accepted'),
      'hw_submitted',    (select count(*) from hw_rows where status = 'submitted'),
      'hw_returned',     (select count(*) from hw_rows where status = 'returned'),
      'hw_pending',      (select count(*) from hw_rows where status in ('not_started', 'draft')),
      'hw_overdue',      (select count(*) from hw_rows where is_overdue),
      -- Средний балл считается отдельно по шкалам: смешивать 5 и 100 нельзя.
      'avg_score_five',    (select round(avg(score)::numeric, 1) from hw_rows
                             where status = 'accepted' and score is not null and grade_scale = 'five'),
      'avg_score_hundred', (select round(avg(score)::numeric, 1) from hw_rows
                             where status = 'accepted' and score is not null and grade_scale = 'hundred'),
      'tests_total',       (select count(*) from test_rows),
      'tests_completed',   (select count(*) from test_rows where status = 'completed'),
      'tests_avg_percent', (select round(avg(percent)) from test_rows where percent is not null)
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_student_topic_journal(uuid, uuid) is
  'Журнал ученика по новому контуру: ДЗ тем и тесты тем. Доступ: сам ученик, admin/owner, преподаватель его группы.';

revoke execute on function public.get_student_topic_journal(uuid, uuid) from public;
revoke execute on function public.get_student_topic_journal(uuid, uuid) from anon;
grant  execute on function public.get_student_topic_journal(uuid, uuid) to authenticated;
