-- Заметки преподавателя об ученике: черновик ИИ + сохранённые версии.
--
-- Таблица ВЕРСИОННАЯ и намеренно без UPDATE/DELETE-политик: текущий текст —
-- последняя строка kind='saved', остальные остаются историей мнения о человеке.
-- Так сохранённое физически невозможно перетереть — ни ИИ, ни вторым
-- преподавателем.
--
-- Права: ровно `auth_is_staff_of_student` (преподаватель курса, куратор,
-- админ) — своей копии правила не заводим (урок §21/§29). Ученик и родитель
-- не видят заметки вовсе: политики для них нет, а не «фильтр в клиенте».
create table if not exists public.student_feedback_notes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('ai_draft', 'saved')),
  body        text not null check (length(btrim(body)) > 0),
  -- Какая модель собрала черновик: у сохранённых версий пусто.
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists student_feedback_notes_student_created_idx
  on public.student_feedback_notes (student_id, created_at desc);

alter table public.student_feedback_notes enable row level security;

create policy student_feedback_notes_staff_select
  on public.student_feedback_notes
  for select to authenticated
  using (public.auth_is_staff_of_student(student_id));

-- Клиент вставляет ТОЛЬКО сохранённые версии и только от своего имени.
-- Черновики пишет edge-функция сервисным ключом: подделать «это сказал ИИ»
-- из браузера нельзя.
create policy student_feedback_notes_staff_insert
  on public.student_feedback_notes
  for insert to authenticated
  with check (
    public.auth_is_staff_of_student(student_id)
    and kind = 'saved'
    and author_id = auth.uid()
  );

comment on table public.student_feedback_notes is
  'Обратная связь по ученику: черновики ИИ и сохранённые версии преподавателя. Только персонал (auth_is_staff_of_student). Без UPDATE/DELETE — история не переписывается.';
