-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_zagruzka»). Версия совпадает с schema_migrations.

create or replace function public.topic_autocheck_import(p_topic_id uuid, p_tasks jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_t      jsonb;
  v_ins    integer := 0;
  v_upd    integer := 0;
  v_same   integer := 0;
  v_id     uuid;
  v_copy   record;
  v_copies integer := 0;
  v_n      integer;
  v_type   text;
begin
  if auth.uid() is null then
    if v_role not in ('service_role', '') then
      raise exception 'Нет прав' using errcode = '42501';
    end if;
  elsif not public.topic_material_can_manage(p_topic_id) then
    raise exception 'Нет прав на этот урок' using errcode = '42501';
  end if;
  if not exists (select 1 from topics where id = p_topic_id) then
    raise exception 'Урок не найден' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from topics where id = p_topic_id and kind in ('check', 'control')) then
    raise exception 'Задачи с автопроверкой — только в уроке, не в проверочной или контрольной'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'Нужен непустой массив задач' using errcode = '22023';
  end if;

  for v_t in select * from jsonb_array_elements(p_tasks) loop
    v_type := v_t ->> 'answer_type';
    if coalesce(btrim(v_t ->> 'code'), '') = '' or coalesce(btrim(v_t ->> 'statement_path'), '') = '' then
      raise exception 'У задачи нет кода или файла условия: %', v_t using errcode = '22023';
    end if;
    if v_type = 'number' and (v_t ->> 'answer_value') is null then
      raise exception 'Задача %: у числового ответа нет значения', v_t ->> 'code' using errcode = '22023';
    end if;
    if v_type = 'digits' and coalesce(v_t ->> 'answer_text', '') !~ '^[0-9]+$' then
      raise exception 'Задача %: ответ из цифр должен быть строкой цифр', v_t ->> 'code' using errcode = '22023';
    end if;
    if v_type is null or v_type not in ('number', 'digits') then
      raise exception 'Задача %: тип ответа — number или digits', v_t ->> 'code' using errcode = '22023';
    end if;

    select id into v_id from topic_autocheck_tasks where topic_id = p_topic_id and code = btrim(v_t ->> 'code');
    if v_id is null then
      insert into topic_autocheck_tasks (topic_id, code, position, statement_path, solution_path, answer_type,
                                         answer_value, answer_tol, answer_text, digits_any_order, unit)
      values (p_topic_id, btrim(v_t ->> 'code'), coalesce((v_t ->> 'position')::int, 0),
              v_t ->> 'statement_path', nullif(v_t ->> 'solution_path', ''), v_type,
              case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
              coalesce((v_t ->> 'answer_tol')::numeric, 0),
              case when v_type = 'digits' then v_t ->> 'answer_text' end,
              coalesce((v_t ->> 'digits_any_order')::boolean, false),
              nullif(btrim(coalesce(v_t ->> 'unit', '')), ''));
      v_ins := v_ins + 1;
    else
      update topic_autocheck_tasks k
         set position = coalesce((v_t ->> 'position')::int, 0),
             statement_path = v_t ->> 'statement_path',
             solution_path = nullif(v_t ->> 'solution_path', ''),
             answer_type = v_type,
             answer_value = case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
             answer_tol = coalesce((v_t ->> 'answer_tol')::numeric, 0),
             answer_text = case when v_type = 'digits' then v_t ->> 'answer_text' end,
             digits_any_order = coalesce((v_t ->> 'digits_any_order')::boolean, false),
             unit = nullif(btrim(coalesce(v_t ->> 'unit', '')), ''),
             updated_at = now()
       where k.id = v_id
         and (k.position, k.statement_path, k.solution_path, k.answer_type, k.answer_value, k.answer_tol,
              k.answer_text, k.digits_any_order, k.unit)
             is distinct from
             (coalesce((v_t ->> 'position')::int, 0), v_t ->> 'statement_path', nullif(v_t ->> 'solution_path', ''),
              v_type, case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
              coalesce((v_t ->> 'answer_tol')::numeric, 0), case when v_type = 'digits' then v_t ->> 'answer_text' end,
              coalesce((v_t ->> 'digits_any_order')::boolean, false), nullif(btrim(coalesce(v_t ->> 'unit', '')), ''));
      get diagnostics v_n = row_count;
      if v_n > 0 then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
    end if;
  end loop;

  update topics set lesson_format = 'training' where id = p_topic_id and lesson_format is null;
  perform public._topic_autocheck_ensure_homework(p_topic_id);
  perform public._topic_autocheck_regrade(p_topic_id);

  for v_copy in
    select ct.id from topics ct
      join modules m on m.id = ct.module_id
     where ct.source_topic_id = p_topic_id
  loop
    v_copies := v_copies + 1;
    insert into topic_autocheck_tasks (topic_id, code, position, statement_path, solution_path, answer_type,
                                       answer_value, answer_tol, answer_text, digits_any_order, unit, source_task_id)
    select v_copy.id, k.code, k.position, k.statement_path, k.solution_path, k.answer_type,
           k.answer_value, k.answer_tol, k.answer_text, k.digits_any_order, k.unit, k.id
      from topic_autocheck_tasks k
     where k.topic_id = p_topic_id
    on conflict (topic_id, code) do update
       set position = excluded.position, statement_path = excluded.statement_path,
           solution_path = excluded.solution_path, answer_type = excluded.answer_type,
           answer_value = excluded.answer_value, answer_tol = excluded.answer_tol,
           answer_text = excluded.answer_text, digits_any_order = excluded.digits_any_order,
           unit = excluded.unit, source_task_id = excluded.source_task_id, updated_at = now()
     where (topic_autocheck_tasks.position, topic_autocheck_tasks.statement_path, topic_autocheck_tasks.solution_path,
            topic_autocheck_tasks.answer_type, topic_autocheck_tasks.answer_value, topic_autocheck_tasks.answer_tol,
            topic_autocheck_tasks.answer_text, topic_autocheck_tasks.digits_any_order, topic_autocheck_tasks.unit,
            topic_autocheck_tasks.source_task_id)
           is distinct from
           (excluded.position, excluded.statement_path, excluded.solution_path, excluded.answer_type,
            excluded.answer_value, excluded.answer_tol, excluded.answer_text, excluded.digits_any_order,
            excluded.unit, excluded.source_task_id);
    update topics set lesson_format = 'training' where id = v_copy.id and lesson_format is null;
    perform public._topic_autocheck_ensure_homework(v_copy.id);
    perform public._topic_autocheck_regrade(v_copy.id);
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'copies', v_copies,
                            'total', (select count(*) from topic_autocheck_tasks where topic_id = p_topic_id));
end $$;

create or replace function public.topic_autocheck_reorder(p_topic_id uuid, p_task_ids uuid[])
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.topic_material_can_manage(p_topic_id) then
    raise exception 'Нет прав на этот урок' using errcode = '42501';
  end if;
  update topic_autocheck_tasks k
     set position = x.ord::int, updated_at = now()
    from unnest(p_task_ids) with ordinality as x(id, ord)
   where k.id = x.id and k.topic_id = p_topic_id and k.position is distinct from x.ord::int;
  get diagnostics v_n = row_count;
  update topic_autocheck_tasks c
     set position = s.position, updated_at = now()
    from topic_autocheck_tasks s
   where c.source_task_id = s.id and s.topic_id = p_topic_id and c.position is distinct from s.position;
  return v_n;
end $$;

create or replace function public.trg_topic_lesson_format_sync()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from modules m join courses c on c.id = m.course_id
              where m.id = new.module_id and c.is_template) then
    update topics set lesson_format = new.lesson_format
     where source_topic_id = new.id and lesson_format is distinct from new.lesson_format;
  end if;
  return null;
end $$;

create trigger topics_lesson_format_sync
  after update of lesson_format on public.topics
  for each row when (old.lesson_format is distinct from new.lesson_format)
  execute function public.trg_topic_lesson_format_sync();
