-- Связь teacher_students раньше заводили только два пути:
-- `_accept_invite_core` и `distribute_join_request`. Ученики, попавшие в
-- группу другими путями (ссылка курса `course_join_accept`, ручное
-- добавление через GroupModal/StudentManager, `invite_student_flow`,
-- `distribute_student_courses`), связи не получали — на 9 сентября без неё
-- было 52 ученика из 53. distribute_student_courses синхронно проверяет
-- teacher_students.status='active' и падает FORBIDDEN: not your student,
-- а в интерфейсе это выглядело как «Этот ученик не связан с вами».
--
-- Тот же урок §136: путей зачисления пять и будет ещё, чинить в каждом —
-- рассинхрон. Правильное место — там, где членство реально появляется:
-- триггер на INSERT в group_students. Ставим AFTER INSERT (в отличие от
-- BEFORE INSERT у group_students_reject_template, этот триггер не отменяет
-- вставку и NEW не трогает — только досоздаёт связь).
--
-- Обратный ход (снятие связи при выходе ученика из всех групп
-- преподавателя) сознательно НЕ реализован в этой миграции — решение
-- вынесено оркестратору, см. PROJECT_STATE §144.

create or replace function public.backfill_teacher_student_link()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_teacher_id uuid;
begin
  select g.teacher_id into v_teacher_id
    from public.groups g
   where g.id = new.group_id;

  -- у группы без преподавателя (если такое бывает) связывать некого
  if v_teacher_id is not null then
    insert into public.teacher_students as ts (teacher_id, student_id, source_invite_id)
    values (v_teacher_id, new.student_id, null)
    on conflict on constraint teacher_students_teacher_id_student_id_key
    do update set status = 'active', updated_at = now();
  end if;

  return new;
end;
$fn$;

drop trigger if exists group_students_backfill_teacher_link on public.group_students;
create trigger group_students_backfill_teacher_link
  after insert on public.group_students
  for each row execute function public.backfill_teacher_student_link();

comment on function public.backfill_teacher_student_link() is
  'Гарантирует teacher_students при любом попадании ученика в группу '
  'преподавателя — приглашение, ссылка курса, ручное добавление, '
  'распределение заявок. Висит на INSERT в group_students, единственном '
  'месте, через которое проходят все текущие и будущие пути зачисления.';
