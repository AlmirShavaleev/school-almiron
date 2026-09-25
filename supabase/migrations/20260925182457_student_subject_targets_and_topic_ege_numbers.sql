-- §216. Цель по баллу — на предмет, и номера заданий ЕГЭ у темы.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md). Данные этой миграцией
-- не меняются вовсе — разовое заполнение живёт отдельным файлом
-- PENDING_216_fill.sql и запускается руками после просмотра.
--
-- Миграция только добавляющая: новая таблица, новая колонка, новые политики.
-- Ничего существующего не удаляется, не переименовывается и не сужается —
-- база одна на все ветки, и прод продолжает работать со старой схемой
-- (РАБОЧИЙ_ПРОЦЕСС.md §5).
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. Цель по баллу — на предмет
-- ──────────────────────────────────────────────────────────────────────────
-- Сейчас цель — пара students.target_score + students.target_subject: ОДНА на
-- человека. А предметов у ученика два (физика и профильная математика), и
-- цели у них разные — 80 по физике и 70 по математике в одну пару не
-- помещаются. Решение владельца от 25.09: цель заводится НА ПРЕДМЕТ.
--
-- students.target_score НЕ трогаем: его читают карточка ученика, «Мой
-- прогресс» и настройки на проде, а прод живёт на main. Перенос данных и
-- снятие старого поля — отдельная работа, после слияния этой ветки.
--
-- Ключ «ученик + предмет + тип экзамена», а не «ученик + предмет»: у одного
-- предмета бывают разные экзамены (ЕГЭ и ОГЭ — это разные шкалы: 100 баллов
-- против оценки 2–5), и одна строка на предмет заставила бы выбирать, какую
-- из двух целей потерять.

create table if not exists public.student_subject_targets (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  subject      public.subject_type not null,
  exam_type    public.exam_type    not null,
  -- 0..100 накрывает обе шкалы: балл ЕГЭ и оценку ОГЭ (2–5). Верхнюю границу
  -- ставим по самой широкой шкале, а не по предмету: своей таблицы «сколько
  -- баллов бывает у этого экзамена» в базе нет, и выдумывать её здесь нельзя.
  target_score smallint not null check (target_score between 0 and 100),
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint student_subject_targets_unique unique (student_id, subject, exam_type)
);

comment on table public.student_subject_targets is
  '§216. Целевой балл ученика ПО ПРЕДМЕТУ и типу экзамена. Пишет персонал курса; ученик читает только свои строки. Не заменяет students.target_score — то поле живёт до отдельного решения.';
comment on column public.student_subject_targets.target_score is
  'Целевой балл: шкала ЕГЭ 0–100 либо оценка ОГЭ 2–5. Пусто (строки нет) — цель не задана; отчёт печатает прочерк, а не ноль.';
comment on column public.student_subject_targets.updated_by is
  'Кто поставил цель последним. Политика записи требует, чтобы здесь стоял сам пишущий.';

create index if not exists student_subject_targets_student_idx
  on public.student_subject_targets (student_id);

alter table public.student_subject_targets enable row level security;

grant select, insert, update, delete on public.student_subject_targets to authenticated;

-- Права НЕ изобретаем. Ровно тот же рисунок, что у student_feedback_notes
-- (миграция 20260809114728): вопрос «видит ли этот человек этого ученика» в
-- проекте уже отвечен на таблице students, и ответ там —
-- `is_admin_or_owner() OR auth_is_staff_of_student(id)`.
--
--   * public.auth_is_staff_of_student(uuid) (20260730213917) — персонал курса
--     ученика через одну course_is_staff: админ платформы, владелец курса,
--     преподаватель группы, куратор группы, куратор курса. Своей копии
--     «преподаватель ли он» не пишем — рассинхрон копий породил §21 и §29.
--   * public.is_admin_or_owner() — платформенная роль. Нужен отдельно: у
--     ученика без строки в group_students auth_is_staff_of_student даёт false
--     и запирает цель даже админу, который саму карточку открывает
--     (та же ловушка, что чинили в 20260809114728).
--   * public.auth_student_id() — «кто я как ученик». Один источник на все
--     ученические политики (course_student_has_access, topic_homework и
--     далее), своей копии `students.profile_id = auth.uid()` не заводим.
--
-- Ученику дано ТОЛЬКО чтение своей строки: цель ставит преподаватель, и
-- ученик, правящий себе цель, обессмыслил бы её в отчёте родителю.

drop policy if exists student_subject_targets_select on public.student_subject_targets;
create policy student_subject_targets_select
  on public.student_subject_targets
  for select to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
    or student_id = public.auth_student_id()
  );

drop policy if exists student_subject_targets_staff_insert on public.student_subject_targets;
create policy student_subject_targets_staff_insert
  on public.student_subject_targets
  for insert to authenticated
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );

drop policy if exists student_subject_targets_staff_update on public.student_subject_targets;
create policy student_subject_targets_staff_update
  on public.student_subject_targets
  for update to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  )
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );

-- Удаление — это «цель не задана», обратное действие к вводу. Отдельная
-- политика, а не одна ALL: ученику delete не достаётся ни при какой ошибке
-- в условии.
drop policy if exists student_subject_targets_staff_delete on public.student_subject_targets;
create policy student_subject_targets_staff_delete
  on public.student_subject_targets
  for delete to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Номера заданий ЕГЭ у темы
-- ──────────────────────────────────────────────────────────────────────────
-- Сегодня номер живёт внутри названия обычным текстом: «№13 — Методы решения
-- тригонометрических уравнений», «МЕГАДЗ — №13, 14, 15 Оптика». Собрать по
-- нему статистику нельзя, а в отчёте родитель должен видеть «проседает №13».
--
-- Поле — СПИСОК: номер часто не один («№1,17», «№13, 14, 15», «№22-23»).
-- Пустой массив, а не null: «номера не проставлены» и «номеров нет» для
-- отчёта одно и то же, а два пустых значения на колонку — это два разных
-- условия в каждом запросе.
--
-- Своих политик колонке не нужно: RLS у topics уже есть — чтение
-- topics_select_all, запись topics_manage_teacher через
-- course_is_teacher_staff (20260805215100). Новая колонка наследует их.

alter table public.topics
  add column if not exists ege_task_numbers smallint[] not null default '{}'::smallint[];

comment on column public.topics.ege_task_numbers is
  '§216. Номера заданий ЕГЭ, которые разбирает тема. Список: номеров бывает несколько. Пустой массив — не проставлено.';

-- Проверка только на заведомый мусор: null внутри массива ломает любое
-- unnest-сравнение в отчёте. Диапазон номеров НЕ ограничиваем: своей таблицы
-- «сколько заданий в этом экзамене» в базе нет, а вписывать 27 руками значит
-- завести правило, которое устареет вместе с демоверсией.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.topics'::regclass
       and conname  = 'topics_ege_task_numbers_no_nulls'
  ) then
    alter table public.topics
      add constraint topics_ege_task_numbers_no_nulls
      check (array_position(ege_task_numbers, null) is null);
  end if;
end
$$;

-- Индекс для отчёта: «какие темы про задание №13» — поиск по элементу массива.
create index if not exists topics_ege_task_numbers_gin
  on public.topics using gin (ege_task_numbers);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Разбор номеров из названия — функцией, а не запросом в одном файле
-- ──────────────────────────────────────────────────────────────────────────
-- Разовое заполнение (PENDING_216_fill.sql) состоит из трёх шагов — показать,
-- проставить, проверить, — и во всех трёх разбор должен быть ОДИН И ТОТ ЖЕ.
-- Скопированное трижды регулярное выражение разъезжается с первой же правкой,
-- поэтому разбор живёт функцией, а файл данных её зовёт. Функция остаётся и
-- после заполнения: владельцу предстоит вводить номера руками, и «подставить
-- из названия» понадобится ещё не раз.
--
-- Что ловит:
--   * оба знака номера — кириллический «№» и латинские «Nº» / «N°» (часть
--     названий на проде набрана вторым);
--   * список через запятую: «№1,17» → 1 и 17, «№13, 14, 15» → 13, 14, 15;
--   * диапазон: «№22-23» → 22 и 23, «№1-12» → 1…12;
--   * несколько знаков номера в одном названии — объединяет.
-- Чего НЕ ловит намеренно:
--   * дефис с пробелами («№13 — Методы…») диапазоном не считается: тире с
--     пробелами в этих названиях разделяет номер и тему, а не два номера;
--   * числа длиннее двух цифр («№1-2026») — год, а не номер задания;
--   * номера вне 1..40 — заведомый мусор;
--   * название без знака номера — пустой массив, тема не трогается.
create or replace function public.ege_numbers_from_title(p_title text)
returns smallint[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select array_agg(distinct n order by n)::smallint[]
       from (
         select generate_series(lo, hi) as n
           from (
             select split_part(tok, '-', 1)::int as lo,
                    case when tok like '%-%' then split_part(tok, '-', 2)::int
                         else split_part(tok, '-', 1)::int end as hi
               from (
                 select btrim(replace(replace(raw, '–', '-'), '—', '-')) as tok
                   from (
                     select regexp_split_to_table(m[1], ',') as raw
                       from regexp_matches(
                              coalesce(p_title, ''),
                              '(?:№|[Nn][º°])[[:space:]]*([0-9]{1,2}(?![0-9])(?:-[0-9]{1,2}(?![0-9]))?(?:[[:space:]]*,[[:space:]]*[0-9]{1,2}(?![0-9])(?:-[0-9]{1,2}(?![0-9]))?)*)',
                              'g'
                            ) as m
                   ) split_by_comma
               ) normalized
              where tok <> ''
           ) bounds
          where hi >= lo
       ) expanded
      where n between 1 and 40),
    '{}'::smallint[]);
$$;

comment on function public.ege_numbers_from_title(text) is
  '§216. Номера заданий ЕГЭ, вытащенные из названия темы: «№», «Nº», «N°», список через запятую, диапазон через дефис. Пусто — номера в названии нет. Один разбор на все три шага PENDING_216_fill.sql.';

revoke all on function public.ege_numbers_from_title(text) from public, anon;
grant execute on function public.ege_numbers_from_title(text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Пробы прав — выполнять ОТДЕЛЬНО, в откатываемом блоке
-- ──────────────────────────────────────────────────────────────────────────
-- Ниже комментарием, а не кодом: миграция не должна ничего писать. Прогонять
-- руками, подставив настоящие uuid, и обязательно под ролью `authenticated` —
-- под владельцем таблиц RLS не проверяется вовсе (ловушка §29.4).
--
-- Здесь эти пробы прогонялись на локальном Postgres 16 с уменьшенным слепком
-- схемы (students / group_students / groups / courses / modules / topics плюс
-- course_is_staff, course_is_teacher_staff, auth_is_staff_of_student,
-- auth_student_id, is_admin_or_owner в тех же редакциях, что в
-- supabase/migrations). Результат: преподаватель группы пишет цель и номера;
-- подделать updated_by нельзя; чужой преподаватель не видит цель, не пишет её
-- и не пишет номера чужой темы; ученик видит ТОЛЬКО свою цель, не правит её,
-- не удаляет и не пишет номера; другой ученик чужой цели не видит; владелец
-- платформы видит и пишет; дубль «ученик + предмет + экзамен» отклоняется;
-- students.target_score не тронут.
--
-- begin;
-- set role authenticated;
-- set local request.jwt.claims = '{"sub":"<uuid преподавателя>","role":"authenticated"}';
-- insert into public.student_subject_targets (student_id, subject, exam_type, target_score, updated_by)
--   values ('<uuid ученика>','physics','ege',85,'<uuid преподавателя>');   -- ожидание: INSERT 0 1
-- update public.topics set ege_task_numbers = '{13,14}' where id = '<uuid темы его курса>';  -- UPDATE 1
--
-- set local request.jwt.claims = '{"sub":"<uuid ЧУЖОГО преподавателя>","role":"authenticated"}';
-- select count(*) from public.student_subject_targets;                     -- ожидание: 0
-- update public.student_subject_targets set target_score = 1;              -- ожидание: UPDATE 0
-- update public.topics set ege_task_numbers = '{1}' where id = '<та же тема>'; -- UPDATE 0
--
-- set local request.jwt.claims = '{"sub":"<uuid ученика>","role":"authenticated"}';
-- select count(*) from public.student_subject_targets;                     -- ожидание: 1 (своя)
-- update public.student_subject_targets set target_score = 100;            -- ожидание: UPDATE 0
-- delete from public.student_subject_targets;                              -- ожидание: DELETE 0
-- update public.topics set ege_task_numbers = '{5}' where id = '<та же тема>'; -- UPDATE 0
--
-- set local request.jwt.claims = '{"sub":"<uuid ДРУГОГО ученика>","role":"authenticated"}';
-- select count(*) from public.student_subject_targets;                     -- ожидание: 0
-- rollback;
