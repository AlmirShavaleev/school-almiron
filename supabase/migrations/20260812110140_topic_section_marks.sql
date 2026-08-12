-- Самоотметки ученика по разделам темы.
--
-- Прогресс держится на них: ученик сам отмечает, что посмотрел видео, прочитал
-- конспект, прорешал задачи. Это ИМЕННО самоотметка, а не факт, и подпись в
-- интерфейсе обязана так и говорить. С автоматическим учётом просмотров
-- (`material_views`, §107) не смешивать — тот пишется при открытии файла и
-- живёт отдельно.
--
-- Ключ по тройке: одна отметка на ученика, тему и раздел. Снятие отметки — это
-- УДАЛЕНИЕ строки, поэтому UPDATE-политики нет вовсе: у отметки нет полей,
-- которые можно менять.
--
-- Раздела `homework` здесь не будет никогда: его состояние вычисляется из
-- принятой работы. Два источника правды разъехались бы на первом же возврате
-- на доработку — ученик отметил, работу вернули, отметка осталась.
-- То же самое ждёт `test`: сейчас это самоотметка (прохождений на проде ноль,
-- системный зачёт не на чем проверить), но состояние раздела в коде считается
-- ФУНКЦИЕЙ, а не читается из таблицы, поэтому перевод теста на системный зачёт
-- не потребует трогать эту схему — просто перестанем писать сюда строки.
create table if not exists public.topic_section_marks (
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id   uuid not null references public.topics(id)   on delete cascade,
  section    text not null check (section in (
    'theory', 'notes', 'tasks', 'task_solution', 'worksheet_tasks',
    'solution', 'worksheet_homework', 'video', 'test'
  )),
  marked_at  timestamptz not null default now(),
  primary key (student_id, topic_id, section)
);

create index if not exists topic_section_marks_topic_idx
  on public.topic_section_marks (topic_id, student_id);

alter table public.topic_section_marks enable row level security;

-- Читают: сам ученик и персонал его курса. Правило «персонал этого ученика»
-- берём готовое — своей копии не заводим (урок §21/§29).
create policy topic_section_marks_select
  on public.topic_section_marks
  for select to authenticated
  using (
    student_id = public.auth_student_id()
    or public.auth_is_staff_of_student(student_id)
  );

-- Пишет только сам ученик и только про себя. Преподаватель отметить за ученика
-- не может: это самоотметка, чужая рука её обесценивает.
create policy topic_section_marks_own_insert
  on public.topic_section_marks
  for insert to authenticated
  with check (student_id = public.auth_student_id());

create policy topic_section_marks_own_delete
  on public.topic_section_marks
  for delete to authenticated
  using (student_id = public.auth_student_id());

comment on table public.topic_section_marks is
  'Самоотметки ученика по разделам темы («отметил сам», не факт). Раздел homework сюда не пишется — он вычисляется из принятой работы. Снятие отметки = удаление строки, UPDATE не предусмотрен.';
