begin;

do $$
declare
  v_ege_5_count integer;
  v_ege_6_count integer;
  v_ege_9_count integer;
  v_ege_10_count integer;
  v_ege_14_count integer;
  v_ege_15_count integer;
  v_ege_17_count integer;
  v_ege_18_count integer;
  v_oge_1_count integer;
  v_oge_2_count integer;
  v_oge_4_count integer;
  v_oge_12_count integer;
  v_oge_13_count integer;
  v_oge_14_count integer;
  v_oge_16_count integer;
begin
  select count(*) into v_ege_5_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 5
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  select count(*) into v_ege_6_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 6
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_ege_9_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 9
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  select count(*) into v_ege_10_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 10
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_ege_14_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 14
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  select count(*) into v_ege_15_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 15
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_ege_17_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 17
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_ege_18_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ЕГЭ' and s.exam_number = 18
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  select count(*) into v_oge_1_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 1
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_oge_2_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 2
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_oge_4_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 4
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_oge_12_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 12
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_oge_13_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 13
    and t.partial_type = 'matching' and t.max_points = 2;

  select count(*) into v_oge_14_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 14
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  select count(*) into v_oge_16_count
  from public.catalog_tasks t
  join public.catalog_sections s on s.id = t.section_id
  where s.subject = 'Физика' and s.exam_type = 'ОГЭ' and s.exam_number = 16
    and t.partial_type = 'multi_choice' and t.max_points = 2;

  if v_ege_5_count = 0 or v_ege_6_count = 0 or v_ege_9_count = 0 or v_ege_10_count = 0
     or v_ege_14_count = 0 or v_ege_15_count = 0 or v_ege_17_count = 0 or v_ege_18_count = 0
     or v_oge_1_count = 0 or v_oge_2_count = 0 or v_oge_4_count = 0 or v_oge_12_count = 0
     or v_oge_13_count = 0 or v_oge_14_count = 0 or v_oge_16_count = 0 then
    raise exception 'Backfill verification failed: one or more target sections have zero patched tasks';
  end if;

  if public.score_partial_matching('1234', '123') <> 0 then
    raise exception 'matching longer-than-key must score 0';
  end if;

  if public.score_partial_matching('12', '123') <> 1 then
    raise exception 'matching one missing position must score 1';
  end if;

  if public.score_partial_matching('1', '123') <> 0 then
    raise exception 'matching two missing positions must score 0';
  end if;

  if public.score_partial_matching('132', '123') <> 0 then
    raise exception 'matching permutation must score 0';
  end if;

  if public.score_partial_multi_choice('321', '123') <> 2 then
    raise exception 'multi_choice permutation must score 2';
  end if;

  if public.score_partial_multi_choice('1234', '123') <> 1 then
    raise exception 'multi_choice one extra digit must score 1';
  end if;

  if public.score_partial_multi_choice('113', '13') = 2 then
    raise exception 'multi_choice duplicate digit must not score 2';
  end if;

  if public.score_partial_multi_choice('113', '13') <> 1 then
    raise exception 'multi_choice duplicate digit should score 1';
  end if;

  raise notice 'Backfill counts: ЕГЭ #5=% #6=% #9=% #10=% #14=% #15=% #17=% #18=%; ОГЭ #1=% #2=% #4=% #12=% #13=% #14=% #16=%',
    v_ege_5_count, v_ege_6_count, v_ege_9_count, v_ege_10_count, v_ege_14_count, v_ege_15_count, v_ege_17_count, v_ege_18_count,
    v_oge_1_count, v_oge_2_count, v_oge_4_count, v_oge_12_count, v_oge_13_count, v_oge_14_count, v_oge_16_count;
  raise notice 'Scoring edge cases passed';
end
$$;

rollback;
