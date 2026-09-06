-- Кэш распознанного авторского решения + отметка, был ли эталон у проверки.
--
-- Зачем. `check-homework-ai` читал решение с условием `kind = 'text'`, а на
-- проде все 844 материала рубрики `solution` — PDF-файлы. Эталон не доезжал до
-- модели НИ РАЗУ: она решала задачу с нуля сама и снижала балл за расхождение
-- со своим же решением. Отсюда «много ошибок» и «слишком строг» (жалоба
-- владельца 16.08).
--
-- Кэш нужен, чтобы не платить за разбор одного и того же PDF при каждой
-- проверке. Разбор ленивый: первая проверка ДЗ по теме разбирает решение и
-- кладёт текст сюда, следующие берут готовое. Пачкой все 844 не гоняем —
-- большинство тем никто никогда не проверит.
create table if not exists public.topic_material_text_cache (
  material_id  uuid primary key references public.topic_material_items(id) on delete cascade,
  -- Файл могли заменить, оставив ту же строку материала: сверяем путь и
  -- размер, при расхождении разбираем заново.
  storage_path text not null,
  size_bytes   bigint,
  engine       text not null check (engine in ('cloudflare-ai', 'mistral-ocr')),
  text         text not null,
  chars        integer not null,
  created_at   timestamptz not null default now()
);

-- RLS включена, политик НЕТ ВОВСЕ — сюда ходит только edge-функция сервисным
-- ключом. Это не забывчивость: эталон решения не должен уезжать в браузер,
-- иначе ученик получит решение ДЗ до сдачи.
alter table public.topic_material_text_cache enable row level security;

comment on table public.topic_material_text_cache is
  'Распознанный текст материалов (авторские решения в PDF) для ИИ-проверки ДЗ. Только сервисный ключ: политик чтения нет намеренно — ученик не должен получить решение через сеть.';

-- Преподаватель обязан понимать, чему верит: проверка без эталона — это другой
-- уровень доверия, и в панели она помечается.
alter table public.topic_homework_ai_jobs
  add column if not exists reference_state text
    check (reference_state in ('used', 'missing', 'failed')),
  add column if not exists reference_chars integer;

comment on column public.topic_homework_ai_jobs.reference_state is
  'Был ли у проверки авторский эталон: used — подставлен, missing — у темы нет решения, failed — разбор PDF не удался. NULL — проверка старее §135.';
