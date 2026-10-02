-- §255 — часть 1: таблица цели ученика
-- Применено оркестратором 02.10 MCP apply_migration. §255 собран из PENDING_255.sql, применён четырьмя миграциями
-- (MCP-инструмент зависал на «drop policy»): 20261002152136 → 20261002153317 → 20261002153407 → 20261002153604.
-- Полные объяснения решений — в шапке и комментариях ниже и в PROJECT_STATE.md §255.

-- ── Цель ученика: своя таблица student_exam_goals, а не student_subject_targets ─
-- Цель по предмету уже есть — student_subject_targets (§216), но её ставит
-- ПРЕПОДАВАТЕЛЬ, и на ней стоит отчёт родителю (student_progress_report); §216
-- прямо закрыл ученику запись: «ученик, правящий себе цель, обессмыслил бы её в
-- отчёте родителю». Решение владельца 02.10 — цель на главной ставит САМ
-- ученик, учитель её видит. Писать ученика в ту же строку значит молча менять
-- отчёт родителю и устраивать перетягивание (учитель 70 → ученик 90 → учитель
-- 70). Поэтому цель ученика — отдельная таблица; учительская цель не тронута, а
-- в карточке ученика у учителя обе рядом («цель ученика — 80»).
--
-- Запись — только definer-функцией set_my_exam_goal (проверка 1..100, «предмет
-- вашего ЕГЭ-курса», понятные ошибки); прямых прав insert/update/delete на
-- таблицу нет ни у кого из клиентских ролей. Чтение — RLS: сам ученик, админ
-- платформы, персонал курса ученика (auth_is_staff_of_student → course_is_staff,
-- одно определение «персонала» на проект). Посторонний преподаватель не видит.

create table if not exists public.student_exam_goals (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject    public.subject_type not null check (subject in ('math', 'physics')),
  goal       smallint not null check (goal between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (profile_id, subject)
);

alter table public.student_exam_goals enable row level security;
revoke all on table public.student_exam_goals from public, anon, authenticated;
grant select on table public.student_exam_goals to authenticated;
