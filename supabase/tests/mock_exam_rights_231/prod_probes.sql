-- §231. Пробы для ПРОДА — прогнать после применения PENDING_231.sql.
-- Каждый блок — DO, откатывается целиком исключением 'PROBE:<отчёт>' в конце
-- (данные и роль возвращаются). Роль и claims — отдельными операторами perform.
-- Отчёт — в тексте ошибки: «что=факт (ждём ожидаемое)», в конце OK или FAIL.
--
-- Подставить uuid ПРОФИЛЕЙ (profiles.id):
--   <teacher_own>   преподаватель группы (groups.teacher_id → его teachers), в которой учится <student>
--                   и у которой есть хотя бы один пробник;
--   <teacher_other> преподаватель, НЕ персонал курса этой группы (своя группа другого курса);
--   <curator>       куратор курса этой группы (course_curators), роль curator;
--   <student>       ученик этой группы.
-- Пробник берётся сам: пробник группы <teacher_own>, где учится <student>, — с итогами, если такой есть, иначе последний.

-- ── 1. Преподаватель своей группы ────────────────────────────────────────────
do $$
declare
  u uuid := '<teacher_own>';
  v_exam uuid; v_group uuid; v_tid uuid; v_other_group uuid; v_results bigint;
  v_new uuid := gen_random_uuid(); n bigint; r text := ''; ok boolean := true;
begin
  select me.id, me.group_id into v_exam, v_group
    from mock_exams me join groups g on g.id = me.group_id join teachers t on t.id = g.teacher_id
   where t.profile_id = u
     and exists (select 1 from group_students gs join students s on s.id = gs.student_id
                  where gs.group_id = me.group_id and s.profile_id = '<student>')
   order by exists (select 1 from mock_exam_results x where x.mock_exam_id = me.id) desc, me.created_at desc limit 1;
  if v_exam is null then raise exception 'PROBE: нет пробника группы <teacher_own> с <student>'; end if;
  select id into v_tid from teachers where profile_id = u;
  select g.id into v_other_group from groups g join teachers t on t.id = g.teacher_id
   where t.profile_id = '<teacher_other>' limit 1;
  select count(*) into v_results from mock_exam_results where mock_exam_id = v_exam;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  select count(*) into n from mock_exams where id = v_exam;
  r := r || format('видит пробник=%s (ждём 1); ', n); ok := ok and n = 1;
  select count(*) into n from mock_exam_results where mock_exam_id = v_exam;
  r := r || format('видит итоги=%s (ждём %s); ', n, v_results); ok := ok and n = v_results;
  update mock_exams set title = title where id = v_exam; get diagnostics n = row_count;
  r := r || format('правка=%s (ждём 1); ', n); ok := ok and n = 1;
  update mock_exam_results set notes = notes where mock_exam_id = v_exam; get diagnostics n = row_count;
  r := r || format('правка итогов=%s (ждём %s); ', n, v_results); ok := ok and n = v_results;
  execute 'insert into mock_exams (id, title, subject, exam_type, date, group_id, template_id, created_by)
           select $1, ''PROBE'', subject, exam_type, now(), group_id, template_id, $2 from mock_exams where id = $3 returning id'
    using v_new, v_tid, v_exam;
  get diagnostics n = row_count;
  r := r || format('создать в свою группу=%s (ждём 1); ', n); ok := ok and n = 1;
  delete from mock_exams where id = v_new; get diagnostics n = row_count;
  r := r || format('удалить созданный=%s (ждём 1); ', n); ok := ok and n = 1;
  if v_other_group is not null then
    begin
      execute 'insert into mock_exams (title, subject, exam_type, date, group_id) values (''PROBE'', ''math'', ''ege'', now(), $1)' using v_other_group;
      r := r || 'создать в чужую группу=ПРОШЛО (ждём 42501); '; ok := false;
    exception when others then
      r := r || format('создать в чужую группу=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
    end;
  end if;
  raise exception 'PROBE:%', r || case when ok then 'OK' else 'FAIL' end;
end $$;

-- ── 2. Посторонний преподаватель ─────────────────────────────────────────────
do $$
declare
  u uuid := '<teacher_other>';
  v_exam uuid; v_group uuid; v_student uuid; n bigint; r text := ''; ok boolean := true;
begin
  select me.id, me.group_id into v_exam, v_group
    from mock_exams me join groups g on g.id = me.group_id join teachers t on t.id = g.teacher_id
   where t.profile_id = '<teacher_own>'
     and exists (select 1 from group_students gs join students s on s.id = gs.student_id
                  where gs.group_id = me.group_id and s.profile_id = '<student>')
   order by exists (select 1 from mock_exam_results x where x.mock_exam_id = me.id) desc, me.created_at desc limit 1;
  select s.id into v_student from students s where s.profile_id = '<student>';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  r := r || format('course_is_staff=%s (ждём f); ',
         public.course_is_staff((select g.course_id from groups g where g.id = v_group)));
  select count(*) into n from mock_exams where id = v_exam;
  r := r || format('видит чужой пробник=%s (ждём 0); ', n); ok := ok and n = 0;
  select count(*) into n from mock_exam_results where mock_exam_id = v_exam;
  r := r || format('видит чужие итоги=%s (ждём 0); ', n); ok := ok and n = 0;
  update mock_exams set title = 'PROBE' where id = v_exam; get diagnostics n = row_count;
  r := r || format('правка=%s (ждём 0); ', n); ok := ok and n = 0;
  delete from mock_exams where id = v_exam; get diagnostics n = row_count;
  r := r || format('удаление=%s (ждём 0); ', n); ok := ok and n = 0;
  update mock_exam_results set score = 0 where mock_exam_id = v_exam; get diagnostics n = row_count;
  r := r || format('правка итогов=%s (ждём 0); ', n); ok := ok and n = 0;
  delete from mock_exam_results where mock_exam_id = v_exam; get diagnostics n = row_count;
  r := r || format('удаление итогов=%s (ждём 0); ', n); ok := ok and n = 0;
  begin
    execute 'insert into mock_exams (title, subject, exam_type, date, group_id) values (''PROBE'', ''math'', ''ege'', now(), $1)' using v_group;
    r := r || 'создать в чужую группу=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('создать в чужую группу=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  begin
    execute 'insert into mock_exam_results (mock_exam_id, student_id, score) values ($1, $2, 0)' using v_exam, v_student;
    r := r || 'вставить итог=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('вставить итог=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  raise exception 'PROBE:%', r || case when ok then 'OK' else 'FAIL' end;
end $$;

-- ── 3. Куратор курса: читает, не управляет ───────────────────────────────────
do $$
declare
  u uuid := '<curator>';
  v_exam uuid; v_group uuid; v_student uuid; v_results bigint; v_scores bigint;
  n bigint; r text := ''; ok boolean := true;
begin
  select me.id, me.group_id into v_exam, v_group
    from mock_exams me join groups g on g.id = me.group_id join teachers t on t.id = g.teacher_id
   where t.profile_id = '<teacher_own>'
     and exists (select 1 from group_students gs join students s on s.id = gs.student_id
                  where gs.group_id = me.group_id and s.profile_id = '<student>')
   order by exists (select 1 from mock_exam_results x where x.mock_exam_id = me.id) desc, me.created_at desc limit 1;
  select s.id into v_student from students s where s.profile_id = '<student>';
  select count(*) into v_results from mock_exam_results where mock_exam_id = v_exam;
  select count(*) into v_scores from mock_exam_task_scores where mock_exam_id = v_exam;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  select count(*) into n from mock_exams where id = v_exam;
  r := r || format('видит пробник=%s (ждём 1); ', n); ok := ok and n = 1;
  select count(*) into n from mock_exam_results where mock_exam_id = v_exam;
  r := r || format('видит итоги=%s (ждём %s); ', n, v_results); ok := ok and n = v_results;
  update mock_exams set title = 'PROBE' where id = v_exam; get diagnostics n = row_count;
  r := r || format('правка=%s (ждём 0); ', n); ok := ok and n = 0;
  delete from mock_exams where id = v_exam; get diagnostics n = row_count;
  r := r || format('удаление=%s (ждём 0); ', n); ok := ok and n = 0;
  update mock_exam_results set score = 0 where mock_exam_id = v_exam; get diagnostics n = row_count;
  r := r || format('правка итогов=%s (ждём 0); ', n); ok := ok and n = 0;
  delete from mock_exam_task_scores where mock_exam_id = v_exam; get diagnostics n = row_count;
  r := r || format('удаление баллов=%s (ждём 0, баллов всего %s); ', n, v_scores); ok := ok and n = 0;
  begin
    execute 'insert into mock_exams (title, subject, exam_type, date, group_id) values (''PROBE'', ''math'', ''ege'', now(), $1)' using v_group;
    r := r || 'создать пробник=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('создать пробник=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  begin
    execute 'insert into mock_exam_results (mock_exam_id, student_id, score) values ($1, $2, 0)' using v_exam, v_student;
    r := r || 'вставить итог=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('вставить итог=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  raise exception 'PROBE:%', r || case when ok then 'OK' else 'FAIL' end;
end $$;

-- ── 4. Ученик группы и посторонний ученик ────────────────────────────────────
do $$
declare
  u uuid := '<student>';
  v_exam uuid; v_group uuid; v_student uuid; v_other uuid; v_res jsonb;
  n bigint; r text := ''; ok boolean := true;
begin
  select me.id, me.group_id into v_exam, v_group
    from mock_exams me join groups g on g.id = me.group_id join teachers t on t.id = g.teacher_id
   where t.profile_id = '<teacher_own>'
     and exists (select 1 from group_students gs join students s on s.id = gs.student_id
                  where gs.group_id = me.group_id and s.profile_id = u)
   order by exists (select 1 from mock_exam_results x where x.mock_exam_id = me.id) desc, me.created_at desc limit 1;
  select s.id into v_student from students s where s.profile_id = u;
  -- посторонний ученик: любой ученик не из этой группы
  select s.profile_id into v_other from students s
   where s.profile_id is not null
     and not exists (select 1 from group_students gs where gs.group_id = v_group and gs.student_id = s.id)
   limit 1;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  select count(*) into n from mock_exams where id = v_exam;
  r := r || format('видит пробник группы=%s (ждём 1); ', n); ok := ok and n = 1;
  select count(*) into n from mock_exam_results;
  r := r || format('таблица итогов напрямую=%s (ждём 0); ', n); ok := ok and n = 0;
  update mock_exams set title = 'PROBE' where id = v_exam; get diagnostics n = row_count;
  r := r || format('правка пробника=%s (ждём 0); ', n); ok := ok and n = 0;
  delete from mock_exams where id = v_exam; get diagnostics n = row_count;
  r := r || format('удаление пробника=%s (ждём 0); ', n); ok := ok and n = 0;
  begin
    execute 'insert into mock_exam_results (mock_exam_id, student_id, score) values ($1, $2, 100)' using v_exam, v_student;
    r := r || 'вставить себе итог=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('вставить себе итог=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  v_res := public.my_mock_exam_result(v_exam);
  r := r || format('my_mock_exam_result.status=%s (ждём ready или pending); ', v_res->>'status');
  ok := ok and v_res->>'status' in ('ready', 'pending');
  select count(*) into n from public.my_mock_exams(v_group);
  r := r || format('my_mock_exams(группа)=%s строк; ', n);

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select count(*) into n from mock_exams where id = v_exam;
  r := r || format('посторонний ученик видит пробник=%s (ждём 0); ', n); ok := ok and n = 0;
  begin
    perform public.my_mock_exam_result(v_exam);
    r := r || 'посторонний my_mock_exam_result=ПРОШЛО (ждём 42501); '; ok := false;
  exception when others then
    r := r || format('посторонний my_mock_exam_result=%s (ждём 42501); ', sqlstate); ok := ok and sqlstate = '42501';
  end;
  raise exception 'PROBE:%', r || case when ok then 'OK' else 'FAIL' end;
end $$;

-- ── 5. Политики после миграции (без смены роли) ──────────────────────────────
-- Ждём 12 строк: mock_exams — select/insert/update/delete; mock_exam_results —
-- staff_select, manage_insert/update/delete; mock_exam_task_scores — 4 прежних имени.
select tablename, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename in ('mock_exams', 'mock_exam_results', 'mock_exam_task_scores')
 order by 1, 2;
