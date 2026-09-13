-- §151. Политики чтения плана (course_study_plans, course_study_plan_items)
-- вызывают course_student_has_access(course_id) под ролью ученика, а у
-- функции не было права вызова для authenticated: до этого её звали только
-- security-definer обёртки. Без grant любой SELECT ученика по таблицам плана
-- падал с 42501. Только grant, тело функции не тронуто.
grant execute on function public.course_student_has_access(uuid) to authenticated;
