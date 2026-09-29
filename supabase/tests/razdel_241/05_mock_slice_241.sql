-- §241. Пробники поверх цепочки §240 (../kontrolnaya_240): её слепок уже
-- создаёт темы/модули/ДЗ теми же файлами, что на проде, а цепочка пробников
-- (../mock_exam_lesson_221 → §231) заводит свои урезанные modules/topics и с
-- ней не складывается. Поэтому здесь — только то, что читают функции §241:
-- столбцы и таблицы пробников — подмножество настоящих (имена и типы как в
-- 20260925201156 / 20260925211232 / 20260926051556 / 20260926065848),
-- mock_exam_window — ДОСЛОВНО из 20260926051556.
alter table public.mock_exams
  add column if not exists template_id         uuid,
  add column if not exists module_id           uuid references public.modules(id) on delete set null,
  add column if not exists module_position     integer not null default 0,
  add column if not exists starts_at           timestamptz,
  add column if not exists duration_minutes    smallint not null default 240,
  add column if not exists photo_grace_minutes smallint not null default 15;
alter table public.mock_exam_results
  alter column score drop not null,
  add column if not exists primary_score integer,
  add column if not exists notified_at   timestamptz;

create table public.mock_exam_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  max_points smallint[] not null,
  part1_last smallint not null
);
alter table public.mock_exams add constraint mock_exams_template_fk foreign key (template_id) references public.mock_exam_templates(id);
create table public.mock_exam_sheets (
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  answers      text[] not null default '{}',
  submitted_at timestamptz,
  opened_at    timestamptz,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (mock_exam_id, student_id)
);
create table public.mock_exam_photos (
  id           uuid primary key default gen_random_uuid(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  storage_path text not null unique,
  file_name    text not null
);
alter table public.mock_exam_sheets enable row level security;
alter table public.mock_exam_photos enable row level security;
alter table public.mock_exam_templates enable row level security;

create or replace function public.mock_exam_window(p_mock_exam_id uuid)
returns table (starts_at timestamptz, ends_at timestamptz, photos_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select me.starts_at,
         me.starts_at + make_interval(mins => me.duration_minutes),
         me.starts_at + make_interval(mins => me.duration_minutes + me.photo_grace_minutes)
    from public.mock_exams me
   where me.id = p_mock_exam_id;
$$;

revoke all on function public.mock_exam_window(uuid) from public, anon;
grant execute on function public.mock_exam_window(uuid) to authenticated;
