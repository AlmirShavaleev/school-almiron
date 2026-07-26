-- ============================================================
-- Hardening прав на функции модуля course_lessons
-- Дополняет 20260725222605_course_lessons_and_materials
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-25 через одобренный MCP-процесс.
--   version = 20260725223951
--   name    = course_lessons_harden_function_grants
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- ============================================================
-- Проблема: в схеме public функции по умолчанию получают EXECUTE
-- для PUBLIC, поэтому все 11 функций миграции были доступны роли
-- anon через /rest/v1/rpc/. Для read-only хелперов это утечка
-- мелкой информации, но course_default_module — SECURITY DEFINER
-- и ПИШЕТ в modules, то есть был анонимный путь записи.
--
-- Здесь только REVOKE/GRANT и один SET search_path.
-- Таблицы, политики, триггеры и другие модули не трогаются.
--
-- Принцип: сначала снимаем PUBLIC (это же снимает anon, который
-- наследует привилегии PUBLIC), затем точечно возвращаем
-- authenticated там, где функция реально нужна — то есть
-- вызывается ИЗ ВЫРАЖЕНИЯ RLS-политики или из frontend RPC.
-- Функции, вызываемые только внутри других SECURITY DEFINER
-- функций, выполняются от владельца и прямого гранта не требуют.
-- ============================================================

-- ------------------------------------------------------------
-- 1. course_touch_updated_at: фиксируем search_path
-- ------------------------------------------------------------
-- Единственная функция модуля, оставшаяся без него.
-- CREATE OR REPLACE сохраняет существующий ACL — гранты снимаем ниже.
create or replace function public.course_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on function public.course_touch_updated_at() is
  'Триггерная функция updated_at. Вызывается только триггерами, прямой EXECUTE отозван.';

-- ------------------------------------------------------------
-- 2. Снимаем EXECUTE для PUBLIC/anon/authenticated со ВСЕХ функций модуля
-- ------------------------------------------------------------
-- Явно перечисляем anon и authenticated: у них есть собственные гранты
-- от supabase default privileges, снятия PUBLIC недостаточно.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'course_default_module',
         'course_ensure_default_module',
         'course_touch_updated_at',
         'course_is_admin',
         'course_is_staff',
         'course_is_lesson_staff',
         'course_of_topic',
         'course_student_has_access',
         'course_student_can_see_topic',
         'course_student_can_see_lesson',
         'course_lesson_view'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    -- владелец и service_role сохраняют доступ
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Возвращаем authenticated только там, где это необходимо
-- ------------------------------------------------------------
-- Выражения RLS-политик вычисляются с правами текущей роли, поэтому
-- на функции, названные в политиках напрямую, EXECUTE обязателен —
-- иначе любой SELECT по таблице упадёт с permission denied.

-- политика course_lessons_staff_all
grant execute on function public.course_of_topic(uuid)               to authenticated;
grant execute on function public.course_is_staff(uuid)               to authenticated;
-- политика course_lessons_student_select
grant execute on function public.course_student_can_see_topic(uuid)  to authenticated;
-- политики course_lesson_materials_staff_all + storage course_lesson_files_write/read
grant execute on function public.course_is_lesson_staff(uuid)        to authenticated;
-- политики course_lesson_materials_student_select + storage course_lesson_files_read
grant execute on function public.course_student_can_see_lesson(uuid) to authenticated;
-- frontend RPC, SECURITY INVOKER — видимость определяет RLS
grant execute on function public.course_lesson_view(uuid)            to authenticated;

-- ------------------------------------------------------------
-- 4. Итоговое состояние (для ревью)
-- ------------------------------------------------------------
--   ЗАКРЫТЫ полностью (только владелец + service_role):
--     course_default_module(uuid)        — SECURITY DEFINER writer,
--                                          работает через триггер от владельца
--     course_ensure_default_module()     — триггерная
--     course_touch_updated_at()          — триггерная
--     course_is_admin()                  — вызывается внутри course_is_staff
--     course_student_has_access(uuid)    — вызывается внутри
--                                          course_student_can_see_topic
--
--   ДОСТУПНЫ authenticated (нужны политикам или фронту), anon закрыт:
--     course_of_topic, course_is_staff, course_is_lesson_staff,
--     course_student_can_see_topic, course_student_can_see_lesson,
--     course_lesson_view
--
-- Триггеры продолжают работать: EXECUTE на триггерной функции
-- проверяется в момент CREATE TRIGGER, а не при срабатывании.
-- ============================================================
