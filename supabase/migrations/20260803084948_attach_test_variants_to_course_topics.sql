-- В программе курса диалог привязки тестирования читал только topic_tests
-- («Банк тестов»), поэтому тесты нового раздела (test_variants) там не
-- находились вовсе. Решение владельца: привязка к теме = настоящая выдача
-- группам курса, а не отдельная сущность показа.
--
-- Так работает весь существующий контур: дедлайны, попытки, автопроверка,
-- страница результатов и счётчик прохождений из §52. Связь «показать на теме,
-- но никому не выдать» дала бы тест, который вечно показывает «ещё никто не
-- прошёл», хотя ученики его решают.
--
-- Курс — это не одна группа: на проде 7 курсов и 11 групп, до четырёх на курс.
-- Поэтому группы выбираются явно, а не подразумеваются.

alter table public.test_variant_assignments
  add column if not exists topic_id uuid references public.topics(id) on delete cascade;

comment on column public.test_variant_assignments.topic_id is
  'Тема курса, из которой выдан тест. NULL — выдача из раздела «Тесты». §58';

create index if not exists test_variant_assignments_topic_id_idx
  on public.test_variant_assignments (topic_id) where topic_id is not null;

-- ── Группы курса для диалога привязки ────────────────────────────────────────

create or replace function public.variant_topic_groups(p_topic_id uuid)
returns table (
  group_id      uuid,
  group_name    text,
  student_count integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select g.id, g.name, count(gs.student_id)::integer
  from public.topics t
  join public.modules m  on m.id = t.module_id
  join public.groups  g  on g.course_id = m.course_id
  left join public.group_students gs on gs.group_id = g.id
  where t.id = p_topic_id
    and public.topic_material_can_manage(p_topic_id)
  group by g.id, g.name
  order by g.name;
$$;

comment on function public.variant_topic_groups(uuid) is
  'Группы курса, которому принадлежит тема, — для выбора при привязке теста. §58';

-- ── Привязка = выдача ────────────────────────────────────────────────────────

create or replace function public.attach_variant_to_topic(
  p_variant_id uuid,
  p_topic_id   uuid,
  p_group_ids  uuid[],
  p_due_at     timestamptz default null
) returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_group_id      uuid;
  v_assignment_id uuid;
  v_created       integer := 0;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.test_variants WHERE id = p_variant_id) THEN
    RAISE EXCEPTION 'NO_VARIANT: test not found';
  END IF;

  IF p_group_ids IS NULL OR array_length(p_group_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_GROUPS: select at least one group';
  END IF;

  -- Группа обязана принадлежать курсу этой темы: иначе через параметр можно
  -- было бы выдать тест куда угодно в обход прав на чужой курс.
  IF EXISTS (
    SELECT 1 FROM unnest(p_group_ids) gid
    WHERE gid NOT IN (
      SELECT g.id
      FROM public.topics t
      JOIN public.modules m ON m.id = t.module_id
      JOIN public.groups  g ON g.course_id = m.course_id
      WHERE t.id = p_topic_id
    )
  ) THEN
    RAISE EXCEPTION 'FOREIGN_GROUP: group does not belong to this course';
  END IF;

  FOREACH v_group_id IN ARRAY p_group_ids LOOP
    -- Повторная привязка той же группы не плодит вторую выдачу.
    IF EXISTS (
      SELECT 1 FROM public.test_variant_assignments
      WHERE variant_id = p_variant_id
        AND topic_id   = p_topic_id
        AND group_id   = v_group_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.test_variant_assignments
      (variant_id, assigned_by, student_id, group_id, topic_id, due_at,
       max_attempts, allow_retry, show_answers_after_submit, show_solutions_after_submit, status)
    VALUES
      (p_variant_id, auth.uid(), NULL, v_group_id, p_topic_id, p_due_at,
       1, false, true, true, 'assigned')
    RETURNING id INTO v_assignment_id;

    INSERT INTO public.test_variant_student_assignments
      (assignment_id, variant_id, student_id, status, due_at, max_attempts)
    SELECT v_assignment_id, p_variant_id, gs.student_id, 'not_started', p_due_at, 1
    FROM public.group_students gs
    WHERE gs.group_id = v_group_id;

    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$function$;

comment on function public.attach_variant_to_topic(uuid, uuid, uuid[], timestamptz) is
  'Привязать тест к теме курса = выдать его выбранным группам курса. §58';

-- ── Открепление ──────────────────────────────────────────────────────────────

create or replace function public.detach_variant_from_topic(
  p_variant_id uuid,
  p_topic_id   uuid
) returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_started integer;
  v_removed integer;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  -- Начатую работу молча стирать нельзя: ответы ученика лежат на строках
  -- test_variant_student_assignments и уйдут вместе с ними.
  SELECT count(*) INTO v_started
  FROM public.test_variant_student_assignments tvsa
  JOIN public.test_variant_assignments tva ON tva.id = tvsa.assignment_id
  WHERE tva.variant_id = p_variant_id
    AND tva.topic_id   = p_topic_id
    AND tvsa.status <> 'not_started';

  IF v_started > 0 THEN
    RAISE EXCEPTION 'HAS_ATTEMPTS:started=%', v_started;
  END IF;

  WITH gone AS (
    DELETE FROM public.test_variant_assignments
    WHERE variant_id = p_variant_id AND topic_id = p_topic_id
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_removed FROM gone;

  RETURN v_removed;
END;
$function$;

comment on function public.detach_variant_from_topic(uuid, uuid) is
  'Отвязать тест от темы курса и снять выдачи. Отказывает, если работу уже начали. §58';

-- ── Что уже привязано к теме ─────────────────────────────────────────────────

create or replace function public.topic_attached_variants(p_topic_id uuid)
returns table (
  variant_id     uuid,
  title          text,
  subject        text,
  exam_type      text,
  tasks_count    integer,
  group_count    integer,
  assigned_count integer,
  passed_count   integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    tv.id, tv.title, tv.subject, tv.exam_type, tv.tasks_count,
    count(distinct tva.group_id)::integer,
    count(tvsa.id)::integer,
    count(tvsa.id) filter (where tvsa.status in ('submitted', 'completed'))::integer
  from public.test_variant_assignments tva
  join public.test_variants tv on tv.id = tva.variant_id
  left join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
  where tva.topic_id = p_topic_id
    and public.topic_material_can_manage(p_topic_id)
  group by tv.id, tv.title, tv.subject, tv.exam_type, tv.tasks_count;
$$;

comment on function public.topic_attached_variants(uuid) is
  'Тесты, привязанные к теме курса, со счётчиками выдачи и прохождений. §58';

revoke all on function public.variant_topic_groups(uuid) from public, anon;
revoke all on function public.attach_variant_to_topic(uuid, uuid, uuid[], timestamptz) from public, anon;
revoke all on function public.detach_variant_from_topic(uuid, uuid) from public, anon;
revoke all on function public.topic_attached_variants(uuid) from public, anon;

grant execute on function public.variant_topic_groups(uuid) to authenticated;
grant execute on function public.attach_variant_to_topic(uuid, uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.detach_variant_from_topic(uuid, uuid) to authenticated;
grant execute on function public.topic_attached_variants(uuid) to authenticated;
