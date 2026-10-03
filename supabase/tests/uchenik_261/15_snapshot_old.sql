-- §261. Снимок ответов ДО PENDING_261 — по нему пробы проверяют «прежний контракт»: student_exam_forecast_evidence()
-- и student_school_points() ученика отвечают как раньше, student_progress_report — прежние поля те же.
-- Под владельцем таблиц (права здесь не проверяются — это делают пробы), claims — отдельным оператором.
create table public._probe_old (k text primary key, v jsonb);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
insert into public._probe_old select 'fc_a', public.student_exam_forecast_evidence();
insert into public._probe_old select 'sp_a', public.student_school_points();

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', false) \g /dev/null
insert into public._probe_old select 'fc_h', public.student_exam_forecast_evidence();
insert into public._probe_old select 'sp_h', public.student_school_points();

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', false) \g /dev/null
insert into public._probe_old select 'rep_a', public.student_progress_report('10000000-0000-4000-8000-0000000000a1', current_date - 30, current_date);
insert into public._probe_old select 'rep_h', public.student_progress_report('10000000-0000-4000-8000-0000000000f1', current_date - 60, current_date);
insert into public._probe_old select 'rep_a_old_period', public.student_progress_report('10000000-0000-4000-8000-0000000000a1', current_date - 250, current_date - 150);

select set_config('request.jwt.claims', '', false) \g /dev/null
