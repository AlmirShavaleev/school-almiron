create role anon;create role authenticated;create role service_role;
create table students(id uuid primary key,profile_id uuid);
create table courses(id uuid primary key,subject text,exam_type text);
create table groups(id uuid primary key,course_id uuid);
create table group_students(group_id uuid,student_id uuid);
create table student_courses(student_id uuid,course_id uuid,status text,expires_at timestamptz);
create table course_unlock_modes(course_id uuid,mode text);
create table student_subscriptions(student_id uuid,course_id uuid,status text,source text,access_until timestamptz);
create table modules(id uuid primary key,course_id uuid);
create table topics(id uuid primary key,module_id uuid,ege_task_numbers int[],available_from date,order_index int,is_open boolean);
create table topic_homework(id uuid primary key,topic_id uuid,autocheck boolean,grade_scale text,is_published boolean);
create table topic_homework_attempts(id uuid primary key,homework_id uuid,student_id uuid,status text,submitted_at timestamptz,attempt_number int,created_at timestamptz);
create table topic_homework_review_tasks(attempt_id uuid,no text,verdict text);
create table topic_homework_reviews(id uuid primary key,attempt_id uuid,score int,created_at timestamptz);
create table topic_autocheck_tasks(id uuid primary key,topic_id uuid);
create table topic_autocheck_answers(profile_id uuid,task_id uuid,is_correct boolean,created_at timestamptz);
create table student_topic_overrides(student_id uuid,topic_id uuid,state text);
create table topic_test_answers(id uuid primary key,attempt_id uuid,item_id uuid,awarded_points numeric,is_correct boolean);
create table topic_test_attempts(id uuid primary key,student_id uuid,assignment_id uuid,status text,completed_at timestamptz);
create table topic_test_items(id uuid primary key,task_id uuid,max_points numeric);
create table topic_test_assignments(id uuid primary key,topic_id uuid);
create table catalog_tasks(id uuid primary key,section_id uuid,is_published boolean,replaced_by_task_id uuid);
create table catalog_sections(id uuid primary key,exam_number int,exam_type text,subject text,is_published boolean);
create table mock_exam_task_scores(mock_exam_id uuid,student_id uuid,task_number int,points numeric);
create table mock_exams(id uuid primary key,subject text,exam_type text,template_id uuid,starts_at timestamptz,date timestamptz);
create table mock_exam_templates(id uuid primary key,max_points int[]);
create table catalog_task_attempts(id uuid primary key,task_id uuid,profile_id uuid,created_at timestamptz,verdict text,revealed_before boolean);
create table test_variant_student_assignments(id uuid primary key,student_id uuid,submitted_at timestamptz);
create table test_variant_answers(id uuid primary key,student_assignment_id uuid,variant_item_id uuid,is_correct boolean,attempts_count int,
 submitted_at timestamptz,graded_at timestamptz,last_changed_at timestamptz,created_at timestamptz);
create table test_variant_items(id uuid primary key,task_id uuid);
create table catalog_task_progress(task_id uuid,user_id uuid,is_completed boolean,completed_at timestamptz,updated_at timestamptz);
create function catalog_subject_key(s text,e text) returns text language sql immutable as $$
 select case when e='ЕГЭ' then case s when 'Математика' then 'math' when 'Физика' then 'physics' end end $$;

