-- §270. Комментарий преподавателя к каждому заданию второй части пробника — ученик видит его в результатах.
-- НЕ ПРИМЕНЕНО. Только добавляющая: новая колонка, новая функция, my_mock_exam_result пересоздана с одним новым полем.
--
-- Где живёт. Комментарий — колонка строки балла `mock_exam_task_scores` (§218): у задания без балла строки нет,
-- и комментарий без балла не нужен (ученик видит номер с «—»). Очистили балл — `save_mock_exam_grid` удаляет строку,
-- уходит и комментарий; экран проверки этого не допускает (комментарий к номеру без балла — ошибка до сохранения).
--
-- Кто пишет. Новая `save_mock_exam_task_comments` — под правами вызывающего, как `save_mock_exam_grid`: та же проверка
-- `course_is_staff` курса группы пробника (иначе 42501), а запись идёт через RLS персонала (`mock_exam_task_scores_staff_update`).
-- `save_mock_exam_grid` НЕ тронута: её upsert обновляет только points, комментарий при пересохранении баллов не теряется.
--
-- Кто читает. Персонал — той же политикой select, что и баллы (экран проверки работы, §228). Ученик — только через
-- `my_mock_exam_result` (definer), то есть после «Уведомить» и конца окна, как и баллы; комментарий — только у номеров
-- второй части. Текст правки после отправки ученик увидит сразу, без нового уведомления (итог не менялся).
--
-- Порядок выкладки: миграция → фронт (экран проверки читает колонку comment; до миграции читает баллы без неё и
-- поле комментария не показывает).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Колонка
-- ──────────────────────────────────────────────────────────────────────────
alter table public.mock_exam_task_scores add column if not exists comment text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mock_exam_task_scores_comment_len'
       and conrelid = 'public.mock_exam_task_scores'::regclass
  ) then
    alter table public.mock_exam_task_scores
      add constraint mock_exam_task_scores_comment_len check (char_length(comment) <= 2000);
  end if;
end;
$$;

comment on column public.mock_exam_task_scores.comment is
  '§270. Комментарий преподавателя ученику к заданию второй части (до 2000 знаков; null — нет). Ученик видит его в my_mock_exam_result после «Уведомить». Пишет save_mock_exam_task_comments.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Сохранение комментариев одного ученика
-- ──────────────────────────────────────────────────────────────────────────
-- p_comments — объект {"14": "текст", "15": null, ...}: ключ — номер задания, значение — текст или null.
-- Пустой после обрезки пробелов текст — null (комментарий убран). Комментарий пишется в СУЩЕСТВУЮЩУЮ строку
-- балла; строки нет — ошибка «сначала поставьте балл» (22023), вся запись откатывается.
-- Возвращает { updated: N } — сколько комментариев изменилось.

create or replace function public.save_mock_exam_task_comments(p_mock_exam_id uuid, p_student_id uuid, p_comments jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_id   uuid;
  v_course_id  uuid;
  v_max_points smallint[];
  v_part1_last int;
  v_key        text;
  v_val        jsonb;
  v_task       int;
  v_text       text;
  v_cnt        int;
  v_updated    int := 0;
begin
  if p_comments is null or jsonb_typeof(p_comments) <> 'object' then
    raise exception 'p_comments: ожидается объект {"номер": "текст" | null}' using errcode = '22023';
  end if;
  if p_student_id is null then
    raise exception 'p_student_id: не указан ученик' using errcode = '22023';
  end if;

  select me.group_id, g.course_id, t.max_points, t.part1_last
    into v_group_id, v_course_id, v_max_points, v_part1_last
    from public.mock_exams me
    left join public.groups g on g.id = me.group_id
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'Пробник не найден' using errcode = 'P0002';
  end if;
  if v_group_id is null then
    raise exception 'У пробника нет группы — результаты не ввести' using errcode = '22023';
  end if;
  -- Та же проверка, что у save_mock_exam_grid (§218): персонал курса группы пробника.
  if not public.course_is_staff(v_course_id) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  if v_max_points is null then
    raise exception 'У пробника нет шаблона — номеров нет' using errcode = '22023';
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_comments) loop
    if v_key !~ '^[0-9]{1,4}$' then
      raise exception 'Номер задания «%»: ожидается целое число', v_key using errcode = '22023';
    end if;
    v_task := v_key::int;
    if v_task <= v_part1_last or v_task > array_length(v_max_points, 1) then
      raise exception 'Задание №%: комментарий пишется только к заданиям второй части', v_task using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) = 'null' then
      v_text := null;
    elsif jsonb_typeof(v_val) = 'string' then
      v_text := nullif(btrim(v_val #>> '{}'), '');
    else
      raise exception 'Задание №%: комментарий должен быть строкой или null', v_task using errcode = '22023';
    end if;
    if char_length(v_text) > 2000 then
      raise exception 'Задание №%: комментарий длиннее 2000 знаков', v_task using errcode = '22023';
    end if;

    perform 1 from public.mock_exam_task_scores
     where mock_exam_id = p_mock_exam_id and student_id = p_student_id and task_number = v_task
       for update;
    if not found then
      raise exception 'Задание №%: сначала поставьте балл', v_task using errcode = '22023';
    end if;

    update public.mock_exam_task_scores
       set comment = v_text
     where mock_exam_id = p_mock_exam_id and student_id = p_student_id and task_number = v_task
       and comment is distinct from v_text;
    get diagnostics v_cnt = row_count;
    v_updated := v_updated + v_cnt;
  end loop;

  return jsonb_build_object('updated', v_updated);
end;
$$;

comment on function public.save_mock_exam_task_comments(uuid, uuid, jsonb) is
  '§270. Сохранить комментарии преподавателя к заданиям второй части одного ученика: {"номер": "текст" | null}. Пустой текст — null. Только в существующую строку балла (иначе 22023 «сначала поставьте балл»). Под правами вызывающего; доступ — как у save_mock_exam_grid (course_is_staff, иначе 42501).';

revoke all on function public.save_mock_exam_task_comments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_mock_exam_task_comments(uuid, uuid, jsonb) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Результат глазами ученика: + comment у заданий второй части
-- ──────────────────────────────────────────────────────────────────────────
-- Тело — живое определение (20260926182241_mock_exam_variants.sql, §229) без изменений, кроме одного поля
-- 'comment' в объекте задания.

create or replace function public.my_mock_exam_result(p_mock_exam_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_r       public.mock_exam_results;
  v_exam    record;
  v_sheet   public.mock_exam_sheets;
  v_key     text[];
  v_w       record;
  v_var     public.mock_exam_variants;
  v_var_id  uuid;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select * into v_r from public.mock_exam_results
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  if not found or v_r.notified_at is null then
    return jsonb_build_object('status', 'pending');
  end if;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  if v_w.ends_at is not null and now() < v_w.ends_at then
    return jsonb_build_object('status', 'pending');
  end if;

  select me.title, me.max_score, me.solution_path, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_sheet from public.mock_exam_sheets
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  v_var_id := public.mock_exam_student_variant(p_mock_exam_id, v_student);
  if v_var_id is not null then
    select * into v_var from public.mock_exam_variants where id = v_var_id;
    select vk.answers into v_key from public.mock_exam_variant_keys vk where vk.variant_id = v_var_id;
  else
    select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;
  end if;

  return jsonb_build_object(
    'status',        'ready',
    'title',         v_exam.title,
    'notified_at',   v_r.notified_at,
    'score',         v_r.score,
    'max_score',     v_exam.max_score,
    'primary_score', v_r.primary_score,
    'part1_score',   v_r.part1_score,
    'part2_score',   v_r.part2_score,
    'part1_last',    v_exam.part1_last,
    'solution_path', case when v_var_id is not null then v_var.solution_path else v_exam.solution_path end,
    'variant',       case when v_var_id is not null then
                       jsonb_build_object('position', v_var.position, 'label', v_var.label)
                     end,
    'tasks',         (select coalesce(jsonb_agg(jsonb_build_object(
                               'n',       i,
                               'max',     m,
                               'points',  sc.points,
                               'answer',  case when i <= v_exam.part1_last then v_sheet.answers[i] end,
                               'correct', case when i <= v_exam.part1_last then v_key[i] end,
                               -- §270. Комментарий преподавателя — только у второй части.
                               'comment', case when i > v_exam.part1_last then sc.comment end)
                             order by i), '[]'::jsonb)
                        from unnest(v_exam.max_points) with ordinality x(m, i)
                        left join public.mock_exam_task_scores sc
                          on sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_student and sc.task_number = i)
  );
end;
$$;

revoke all on function public.my_mock_exam_result(uuid) from public, anon;
grant execute on function public.my_mock_exam_result(uuid) to authenticated;
