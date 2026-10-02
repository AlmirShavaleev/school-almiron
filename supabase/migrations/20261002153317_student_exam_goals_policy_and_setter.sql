-- §255 — часть 2: политика чтения и set_my_exam_goal
-- Применено оркестратором 02.10 MCP apply_migration. §255 собран из PENDING_255.sql, применён четырьмя миграциями
-- (MCP-инструмент зависал на «drop policy»): 20261002152136 → 20261002153317 → 20261002153407 → 20261002153604.
-- Полные объяснения решений — в шапке и комментариях ниже и в PROJECT_STATE.md §255.

comment on table public.student_exam_goals is
  '§255. Цель ЕГЭ, которую ученик поставил себе сам (главная, «Примерный балл»). Пишет только set_my_exam_goal; читают сам ученик, админ и персонал курса ученика. Учительская цель для отчёта родителю — отдельно, student_subject_targets (§216).';

create policy student_exam_goals_select
  on public.student_exam_goals
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_admin_or_owner()
    or exists (
      select 1 from public.students s
       where s.profile_id = student_exam_goals.profile_id
         and public.auth_is_staff_of_student(s.id)
    )
  );

-- ── 2. Цель ученика ───────────────────────────────────────────────────────
-- Пишет student_exam_goals (своя строка). p_goal null — «цели нет»: строка
-- удаляется (на шкале нет отметки, у учителя — прочерк, а не ноль). Предмет —
-- только ЕГЭ-курс групп ученика.
create or replace function public.set_my_exam_goal(p_subject text, p_goal integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'set_my_exam_goal: нужен вход' using errcode = '42501';
  end if;
  if p_subject is null or p_subject not in ('math', 'physics') then
    raise exception 'Цель ставится только по профильной математике и физике' using errcode = '22023';
  end if;
  if p_goal is not null and (p_goal < 1 or p_goal > 100) then
    raise exception 'Цель — целое число от 1 до 100' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.students s
      join public.group_students gs on gs.student_id = s.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where s.profile_id = v_uid
       and c.exam_type::text = 'ege'
       and c.subject::text = p_subject
  ) then
    raise exception 'Цель можно поставить только по предмету своего курса ЕГЭ' using errcode = '42501';
  end if;

  if p_goal is null then
    delete from public.student_exam_goals where profile_id = v_uid and subject::text = p_subject;
    return null;
  end if;

  insert into public.student_exam_goals (profile_id, subject, goal, updated_at)
  values (v_uid, p_subject::public.subject_type, p_goal, now())
  on conflict (profile_id, subject)
  do update set goal = excluded.goal, updated_at = now();
  return p_goal;
end;
$$;

comment on function public.set_my_exam_goal(text, integer) is
  '§255. Ученик ставит себе цель ЕГЭ (1..100; null — снять) по предмету своего ЕГЭ-курса (math | physics). Пишет student_exam_goals; учитель видит её в карточке ученика рядом со своей целью (§216).';

revoke all on function public.set_my_exam_goal(text, integer) from public, anon;
grant execute on function public.set_my_exam_goal(text, integer) to authenticated;
