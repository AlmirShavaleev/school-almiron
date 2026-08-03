-- Уборка данных под закон «один курс = одна группа» (решение владельца
-- 2026-08-03). Ограничение ставится СЛЕДУЮЩЕЙ миграцией, эта только приводит
-- данные в вид, при котором ограничение применимо.
--
-- ОТКАТ. Перед изменениями снимаются три снимка; полный откат:
--   insert into public.groups select * from public.groups_cleanup_backup_20260803;
--   delete from public.group_students gs
--     using public.group_students_cleanup_backup_20260803 b where gs.id = b.id;
--   insert into public.group_students select * from public.group_students_cleanup_backup_20260803;
--   insert into public.enrollment_invites select * from public.enrollment_invites_cleanup_backup_20260803;
--   update public.groups set name = 'Мини-группа · 11А 2026-2027'
--    where id = '32eaf7e1-5d9c-48a2-a447-c8ef228f6c2b';
--   update public.groups set teacher_id = null
--    where id = '6d4cd0f5-f72a-4e44-8711-295f7d90f2dc';
--   delete from public.groups where course_id in
--     ('d3a7f3f8-1e20-455b-9768-1a46c12c0680','d591e2e2-5f47-49da-93db-4b1fb788d3e8');
-- После проверки владельцем снимки можно удалить:
--   drop table public.groups_cleanup_backup_20260803;
--   drop table public.group_students_cleanup_backup_20260803;
--   drop table public.enrollment_invites_cleanup_backup_20260803;
--
-- ЧИСЛА. До правки: 7 курсов, 11 групп, из них 2 сироты на удалённых курсах;
-- 2 курса без группы; 2 курса с несколькими. После (проверено по применении):
-- 7 курсов, 7 групп, ноль курсов без группы, ноль курсов с двумя, ноль сирот.
--
-- Приглашения. Три живых `pending`-приглашения (2 в группе «123», 1 в
-- «Индивидуально · bh») умирают каскадом вместе с группами. Владелец
-- подтвердил: все три тестовые, перевешивать нечего. В снимке они есть.

-- ── 0. Снимки для отката ─────────────────────────────────────────────────────

create table if not exists public.groups_cleanup_backup_20260803 as
select g.* from public.groups g where false;
create table if not exists public.group_students_cleanup_backup_20260803 as
select gs.* from public.group_students gs where false;
create table if not exists public.enrollment_invites_cleanup_backup_20260803 as
select i.* from public.enrollment_invites i where false;

revoke all on public.groups_cleanup_backup_20260803 from public, anon, authenticated;
revoke all on public.group_students_cleanup_backup_20260803 from public, anon, authenticated;
revoke all on public.enrollment_invites_cleanup_backup_20260803 from public, anon, authenticated;

with doomed(id) as (values
 ('6b59d639-c665-4024-a416-832eb946d945'::uuid),  -- 10А «Софья», пустая
 ('26d48a07-09bd-46d8-bb75-0ad46cffb9c5'),        -- 10А «123», 2 приглашения
 ('51fec290-8d82-44e5-bb1d-a4363ea286bb'),        -- 10А «Индивидуально · Almir»
 ('df098fe2-15ff-46d2-83d6-934f6f25d230'),        -- 11А «Индивидуально · bh»
 ('e2e98009-54f0-49d6-b490-0b66a87e63d1'),        -- сирота E2E
 ('1d095cd8-aeff-4e99-a0e3-1e3947c0dc20'))        -- сирота E2E
insert into public.groups_cleanup_backup_20260803
select g.* from public.groups g join doomed d on d.id = g.id;

insert into public.group_students_cleanup_backup_20260803
select gs.* from public.group_students gs
 join public.groups_cleanup_backup_20260803 b on b.id = gs.group_id;

insert into public.enrollment_invites_cleanup_backup_20260803
select i.* from public.enrollment_invites i
 join public.groups_cleanup_backup_20260803 b on b.id = i.group_id;

-- ── 1. 11А: слияние двух групп ───────────────────────────────────────────────
-- Ученики разные («Almir Shavaleev» и «Альмир Ученик»), дублей по
-- unique(group_id, student_id) не возникает.
update public.group_students
   set group_id = '32eaf7e1-5d9c-48a2-a447-c8ef228f6c2b'
 where group_id = 'df098fe2-15ff-46d2-83d6-934f6f25d230';

-- Имя группы = имя курса: формат обучения в названии не кодируем.
update public.groups g
   set name = c.title
  from public.courses c
 where g.id = '32eaf7e1-5d9c-48a2-a447-c8ef228f6c2b' and c.id = g.course_id;

-- ── 2. 10А: преподаватель переезжает на остающуюся группу ────────────────────
-- У остающейся «10 А Лицей Альметьевск» преподавателя не было, у двух
-- сносимых — один и тот же, поэтому перенос однозначен.
update public.groups
   set teacher_id = 'c1000001-0000-0000-0000-000000000000'
 where id = '6d4cd0f5-f72a-4e44-8711-295f7d90f2dc' and teacher_id is null;

-- ── 3. Снос лишних групп ─────────────────────────────────────────────────────
delete from public.groups where id in (
 '6b59d639-c665-4024-a416-832eb946d945',
 '26d48a07-09bd-46d8-bb75-0ad46cffb9c5',
 '51fec290-8d82-44e5-bb1d-a4363ea286bb',
 'df098fe2-15ff-46d2-83d6-934f6f25d230',
 'e2e98009-54f0-49d6-b490-0b66a87e63d1',
 '1d095cd8-aeff-4e99-a0e3-1e3947c0dc20');

-- ── 4. Курсам без группы — своя группа ───────────────────────────────────────
insert into public.groups (course_id, name)
select c.id, c.title from public.courses c
 where not exists (select 1 from public.groups g where g.course_id = c.id);
