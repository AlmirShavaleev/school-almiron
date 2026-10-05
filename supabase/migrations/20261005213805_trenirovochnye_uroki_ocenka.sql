-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_ocenka»). Версия совпадает с schema_migrations.

create or replace function public.topic_homework_autocheck_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.source_homework_id is not null
       and exists (select 1 from topic_homework s where s.id = new.source_homework_id and s.autocheck) then
      new.autocheck := true;
    elsif current_user in ('authenticated', 'anon') then
      new.autocheck := false;
    end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    new.autocheck := old.autocheck;
  end if;
  return new;
end $$;

create trigger topic_homework_autocheck_guard
  before insert or update on public.topic_homework
  for each row execute function public.topic_homework_autocheck_guard();

create or replace function public.topic_homework_attempts_autocheck_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from topic_homework h where h.id = new.homework_id and h.autocheck)
     and coalesce(current_setting('app.topic_autocheck', true), '') <> new.homework_id::text || ':' || new.student_id::text then
    raise exception 'Задачи с автопроверкой сдаются ответами в уроке, а не файлами'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger topic_homework_attempts_autocheck_guard
  before insert on public.topic_homework_attempts
  for each row execute function public.topic_homework_attempts_autocheck_guard();

create or replace function public.topic_homework_reviews_autocheck_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  select a.homework_id::text || ':' || a.student_id::text into v_key
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = new.attempt_id and h.autocheck;
  if v_key is not null and coalesce(current_setting('app.topic_autocheck', true), '') <> v_key then
    raise exception 'Оценку за задачи с автопроверкой ставит сайт: доля решённых задач урока'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger topic_homework_reviews_autocheck_guard
  before insert on public.topic_homework_reviews
  for each row execute function public.topic_homework_reviews_autocheck_guard();

create or replace function public._topic_autocheck_ensure_homework(p_topic_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hw    record;
  v_owner uuid;
  v_id    uuid;
begin
  select h.id, h.autocheck into v_hw from topic_homework h where h.topic_id = p_topic_id;
  if v_hw.id is not null then
    if v_hw.autocheck then
      return v_hw.id;
    end if;
    if exists (select 1 from topic_homework_attempts a where a.homework_id = v_hw.id)
       or exists (select 1 from topic_homework_files f where f.homework_id = v_hw.id) then
      raise exception 'В уроке уже есть ДЗ с файлами или работами учеников — задачи с автопроверкой его не заменят. Уберите это ДЗ или загрузите задачи в другой урок.'
        using errcode = 'check_violation';
    end if;
    update topic_homework
       set autocheck = true, grade_scale = 'hundred', title = 'Задачи с автопроверкой'
     where id = v_hw.id;
    return v_hw.id;
  end if;

  select c.owner_id into v_owner
    from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
   where t.id = p_topic_id;

  insert into topic_homework (topic_id, title, is_published, created_by, grade_scale, autocheck)
  values (p_topic_id, 'Задачи с автопроверкой', false, coalesce(auth.uid(), v_owner), 'hundred', true)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._topic_autocheck_finish(p_topic_id uuid, p_profile_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_total   integer;
  v_closed  integer;
  v_solved  integer;
  v_grade   integer;
  v_student uuid;
  v_hw      uuid;
  v_att     uuid;
  v_last    integer;
  v_comment text;
begin
  select count(*)::int,
         count(*) filter (where public.topic_autocheck_task_closed(t.id, p_profile_id))::int,
         count(*) filter (where exists (select 1 from topic_autocheck_answers a
                                         where a.task_id = t.id and a.profile_id = p_profile_id and a.is_correct))::int
    into v_total, v_closed, v_solved
    from topic_autocheck_tasks t
   where t.topic_id = p_topic_id;

  if v_total = 0 or v_closed < v_total then
    return null;
  end if;

  v_grade := round(100.0 * v_solved / v_total)::int;
  v_student := public._topic_autocheck_student_of(p_topic_id, p_profile_id);
  if v_student is null then
    return v_grade;
  end if;

  v_hw := public._topic_autocheck_ensure_homework(p_topic_id);
  perform public._topic_homework_autopublish(array[v_hw], 'content');

  v_comment := format('Автопроверка: решено %s из %s', v_solved, v_total);
  perform set_config('app.topic_autocheck', v_hw::text || ':' || v_student::text, true);

  select a.id into v_att from topic_homework_attempts a
   where a.homework_id = v_hw and a.student_id = v_student and a.status = 'accepted';

  if v_att is not null then
    select r.score into v_last from topic_homework_reviews r
     where r.attempt_id = v_att order by r.created_at desc, r.id desc limit 1;
    if v_last is distinct from v_grade then
      insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
      values (v_att, p_profile_id, 'accepted', v_comment, v_grade);
    end if;
  else
    insert into topic_homework_attempts (homework_id, student_id, attempt_number)
    values (v_hw, v_student, 1)
    returning id into v_att;
    update topic_homework_attempts set status = 'submitted', submitted_at = now() where id = v_att;
    insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
    values (v_att, p_profile_id, 'accepted', v_comment, v_grade);
    update topic_homework_attempts set status = 'accepted' where id = v_att;
  end if;

  perform set_config('app.topic_autocheck', '', true);
  return v_grade;
end $$;

create or replace function public._topic_autocheck_regrade(p_topic_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_p record;
  v_n integer := 0;
begin
  for v_p in
    select distinct s.profile_id
      from topic_homework h
      join topic_homework_attempts a on a.homework_id = h.id and a.status = 'accepted'
      join students s on s.id = a.student_id
     where h.topic_id = p_topic_id and h.autocheck and s.profile_id is not null
  loop
    if public._topic_autocheck_finish(p_topic_id, v_p.profile_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
