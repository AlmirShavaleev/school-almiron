-- Read-only production regression probe; every session setting is rolled back.
-- Run against a database containing a physics-only subscriber and a math task.
begin;
select set_config('test.catalog_profile', (
  select s.profile_id::text from public.students s
  where exists (select 1 from public.student_subscriptions ss join public.courses c on c.id=ss.course_id
    where ss.student_id=s.id and c.subject::text='physics' and c.exam_type::text='ege'
      and ss.status in ('trial','active','past_due') and ss.access_until>now())
    and not exists (select 1 from public.student_subscriptions ss join public.courses c on c.id=ss.course_id
    where ss.student_id=s.id and c.subject::text='math' and c.exam_type::text='ege'
      and ss.status in ('trial','active','past_due') and ss.access_until>now())
  limit 1), true);
select set_config('test.catalog_foreign_task', (
  select id::text from public.catalog_tasks where subject='Математика' and exam_type='ЕГЭ' and is_published limit 1), true);
select set_config('request.jwt.claims', jsonb_build_object('sub',current_setting('test.catalog_profile'),'role','authenticated')::text, true);
set local role authenticated;
do $$
declare v_task uuid := current_setting('test.catalog_foreign_task')::uuid;
begin
  if coalesce(current_setting('test.catalog_profile'),'')='' or v_task is null then
    raise exception 'Missing probe fixtures';
  end if;
  if public.catalog_subscription_directions() <> array['Физика|ЕГЭ'] then
    raise exception 'Wrong subscriber scope';
  end if;
  if exists(select 1 from public.catalog_tasks where subject<>'Физика' or exam_type<>'ЕГЭ')
    or exists(select 1 from public.catalog_sections where subject<>'Физика' or exam_type<>'ЕГЭ')
    or exists(select 1 from public.catalog_topics where subject<>'Физика' or exam_type<>'ЕГЭ') then
    raise exception 'RLS leaks another direction';
  end if;
  if exists(select 1 from public.catalog_task_texts(array[v_task])) then
    raise exception 'Answer RPC leaks another direction';
  end if;
  if exists(select 1 from public.get_catalog_section_counts('Математика','ЕГЭ')) then
    raise exception 'Count RPC leaks another direction';
  end if;
  begin
    perform public.catalog_reveal_answer(v_task);
    raise exception 'Foreign reveal accepted';
  exception when no_data_found then null;
  end;
  begin
    perform public.catalog_check_answer(v_task,'1');
    raise exception 'Foreign answer check accepted';
  exception when no_data_found then null;
  end;
  if exists(select 1 from jsonb_array_elements(public.catalog_my_overview()->'exams') e
    where e->>'subject'<>'Физика' or e->>'exam_type'<>'ЕГЭ') then
    raise exception 'Overview leaks another direction';
  end if;
end $$;
rollback;
