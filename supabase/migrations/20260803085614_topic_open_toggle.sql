-- Управление открытием тем курса: тумблер вместо обязательной даты.
--
-- Было: единственный рычаг — topics.available_from. Чтобы открыть тему, надо
-- было каждый раз заполнять дату; закрыть открытую тему было нечем.
--
-- Стало: topics.is_open с тремя состояниями —
--   null  — решает дата (ровно прежнее поведение, отсюда обратная совместимость);
--   true  — открыта руками, дата не действует;
--   false — закрыта руками, дата не действует.
--
-- Все существующие темы остаются null: колонка добавляется без default,
-- бэкфилла нет и он не нужен.
--
-- Ниже дословно тот SQL, который применён MCP-миграцией; добавлен только этот
-- заголовок.

alter table public.topics add column if not exists is_open boolean;

comment on column public.topics.is_open is
  'Тумблер открытости темы. null — решает available_from, true/false — решение преподавателя, дата не действует.';

create or replace function public.topic_open_now(p_is_open boolean, p_available_from date)
returns boolean
language sql
stable
as $function$
  select coalesce(p_is_open, p_available_from is null or p_available_from <= current_date);
$function$;

comment on function public.topic_open_now(boolean, date) is
  'Правило открытости темы живёт только здесь, копию в политику не вносить.';

create or replace function public.course_student_can_see_topic(p_topic_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from topics t
      join modules m on m.id = t.module_id
     where t.id = p_topic_id
       and public.topic_open_now(t.is_open, t.available_from)
       and public.course_student_has_access(m.course_id)
  );
$function$;

drop policy if exists topic_materials_select on public.topic_materials;
create policy topic_materials_select on public.topic_materials
for select using (
  is_admin_or_owner()
  or auth_is_staff_of_topic(topic_id)
  or (
    auth_can_see_topic(topic_id)
    and exists (
      select 1 from topics tp
       where tp.id = topic_materials.topic_id
         and public.topic_open_now(tp.is_open, tp.available_from)
    )
  )
);

create or replace function public.get_student_topic_journal(p_student_id uuid, p_course_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
     where public.topic_open_now(t.is_open, t.available_from)
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
$function$;

create or replace function public.course_copy_topic_content(p_source_topic_id uuid, p_target_topic_id uuid, p_mode text, p_shift_days integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_files jsonb := '[]'::jsonb;
  v_row record;
  v_new_path text;
  v_hw_id uuid;
  v_new_hw_id uuid;
begin
  -- Перенос тумблера живёт здесь, а не в course_copy_stage и topic_copy_stage:
  -- обе зовут эту функцию сразу после вставки темы, и только тут есть оба
  -- идентификатора. Одно место — два пути копирования не разъедутся.
  --
  -- Правило: nullif(is_open, true) — false → false, true → null, null → null.
  -- Копия курса делается на новый год со сдвигом дат; тема, рождённая true,
  -- сдвиг бы проигнорировала. Правило НИКОГДА не расширяет доступ: true → null
  -- даёт либо то же самое (даты нет), либо уже (дата в будущем).
  update topics tgt
     set is_open = nullif(src.is_open, true)
    from topics src
   where tgt.id = p_target_topic_id
     and src.id = p_source_topic_id;

  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    v_new_path := null;
    if v_row.storage_path is not null then
      v_new_path := p_target_topic_id::text || '/' ||
                    gen_random_uuid()::text || '-' ||
                    regexp_replace(v_row.storage_path, '^.*/', '');
      v_files := v_files || jsonb_build_object(
        'bucket', 'topic-materials',
        'from', v_row.storage_path,
        'to', v_new_path
      );
    end if;

    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_new_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid()
    );
  end loop;

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale
      from topic_homework where id = v_hw_id
    returning id into v_new_hw_id;

    for v_row in
      select * from topic_homework_files where homework_id = v_hw_id order by position
    loop
      v_new_path := p_target_topic_id::text || '/' ||
                    gen_random_uuid()::text || '-' ||
                    regexp_replace(v_row.storage_path, '^.*/', '');
      v_files := v_files || jsonb_build_object(
        'bucket', 'topic-homework',
        'from', v_row.storage_path,
        'to', v_new_path
      );
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position)
      values (v_new_hw_id, v_new_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position);
    end loop;
  end if;

  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  return v_files;
end $function$;

create or replace function public.topics_open_until(p_topic_id uuid)
returns integer
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_course_id  uuid;
  v_mod_order  integer;
  v_mod_id     uuid;
  v_top_order  integer;
  v_count      integer;
begin
  select m.course_id, m.order_index, m.id, t.order_index
    into v_course_id, v_mod_order, v_mod_id, v_top_order
    from topics t
    join modules m on m.id = t.module_id
   where t.id = p_topic_id;

  if v_course_id is null then
    raise exception 'Тема не найдена';
  end if;

  with opened as (
    update topics t
       set is_open = true
      from modules m
     where m.id = t.module_id
       and m.course_id = v_course_id
       and (
         (m.order_index, m.id) < (v_mod_order, v_mod_id)
         or (m.id = v_mod_id and (t.order_index, t.id) <= (v_top_order, p_topic_id))
       )
       and t.is_open is distinct from true
    returning 1
  )
  select count(*) into v_count from opened;

  return v_count;
end $function$;

grant execute on function public.topics_open_until(uuid) to authenticated;
