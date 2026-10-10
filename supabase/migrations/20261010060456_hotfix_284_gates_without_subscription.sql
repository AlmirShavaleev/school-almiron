-- §284 hotfix: вернуть 4 ворот доступа ученика к телам до §282 (без проверки подписки).
-- Причина: 10.10 08:49 МСК перегрузка базы; subscription_access_ok вызывался на каждую строку RLS.
-- Поведение не меняется: тарифов 0, флаг subscriptions выключен. Подписка вернётся лёгкой версией (§282.2).
create or replace function public.course_student_has_access(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    exists (select 1 from group_students gs
              join groups g on g.id = gs.group_id
             where gs.student_id = public.auth_student_id()
               and g.course_id = p_course_id)
    or exists (select 1 from student_courses sc
                where sc.student_id = public.auth_student_id()
                  and sc.course_id = p_course_id
                  and sc.status in ('active', 'trial')
                  and (sc.expires_at is null or sc.expires_at > now()))
  );
$$;

create or replace function public.mock_exam_my_student_id(p_mock_exam_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id
   where me.id = p_mock_exam_id and s.profile_id = auth.uid()
   limit 1;
$$;

create or replace function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from students s
    join group_students gs on gs.student_id = s.id
    join groups g          on g.id = gs.group_id
   where s.profile_id = p_profile_id
     and g.course_id = public.course_of_topic(p_topic_id)
   order by s.id
   limit 1;
$$;

create or replace function public.auth_is_student_of_topic(p_topic_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    join groups g  on g.course_id = m.course_id
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id
    where tp.id = p_topic_id and s.profile_id = auth.uid()
  );
$$;
