-- §179 (применено оркестратором 15.09, версия 20260915082230; проба: владелец true/false, ученик STAFF_ONLY, записей нет). Вердикт по ответу без записи — для предпросмотра «глазами ученика».
--
-- Зачем. В режиме предпросмотра (§178) владелец проходит урок «как ученик»:
-- вводит ответ, видит «Верно/Неверно», открывает разбор, жмёт «Разобрал» —
-- всё в памяти вкладки. Проверка ответа в проекте ОДНА (CLAUDE.md, §63/§66):
-- normalize_variant_answer + variant_answer_verdict, второй копии на клиенте
-- не заводим. Поэтому вердикт считает база — чистой функцией, которая ничего
-- не пишет: ни test_variant_answers, ни попыток, ни статусов выдачи.
--
-- Кому. Только персоналу платформы. Ученику функция дала бы перебор ответов
-- без следа в журнале попыток (answer_topic_task такой след оставляет) —
-- это утечка эталона, поэтому не «просто grant authenticated», а проверка
-- внутри: строка teachers по auth.uid() или платформенная роль admin/owner.
-- course_is_staff здесь не годится: задача каталога к курсу не привязана.
--
-- Почему plpgsql, а не sql: отказ STAFF_ONLY — это RAISE EXCEPTION, в
-- language sql его нет. Функция stable и security invoker: catalog_tasks
-- читается под RLS вызывающего (персонал читает каталог целиком — так
-- работает страница каталога), права владельца функции не нужны.
--
-- Что возвращает: true/false — вердикт; null — задача не автопроверяемая
-- (по variant_answer_is_auto_checkable, §96/§127), клиент такой ответ не
-- ждёт и показывает «нет короткого ответа».

create or replace function public.preview_task_verdict(
  p_task_id    uuid,
  p_answer_raw text
) returns boolean
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_answer_html  text;
  v_partial_type text;
begin
  if not (
    exists (select 1 from public.teachers t where t.profile_id = auth.uid())
    or public.is_admin_or_owner()
  ) then
    raise exception 'STAFF_ONLY: preview verdict is available to platform staff only';
  end if;

  select ct.answer_html, ct.partial_type
    into v_answer_html, v_partial_type
    from public.catalog_tasks ct
   where ct.id = p_task_id;

  if not found then
    raise exception 'ACCESS_DENIED: task not found';
  end if;

  if not public.variant_answer_is_auto_checkable(v_answer_html, v_partial_type) then
    return null;
  end if;

  -- Та же формула, что в answer_topic_task (миграция 20260912201835).
  return coalesce(
    public.variant_answer_verdict(
      public.normalize_variant_answer(public.strip_html_simple(v_answer_html)),
      public.normalize_variant_answer(p_answer_raw)),
    false);
end;
$function$;

comment on function public.preview_task_verdict(uuid, text) is
  '§179. Вердикт по ответу на задачу каталога без записи — для предпросмотра «глазами ученика». Только персонал платформы (STAFF_ONLY иначе); null — задача не автопроверяемая.';

revoke all on function public.preview_task_verdict(uuid, text) from public, anon;
grant execute on function public.preview_task_verdict(uuid, text) to authenticated;

-- ── Проверка прав (выполнять на проде через MCP в откатываемой транзакции) ──
--
-- begin;
-- -- 1. Ученик (profile без строки teachers, роль student): ожидается STAFF_ONLY.
-- select set_config('role', 'authenticated', true);
-- select set_config('request.jwt.claims', '{"sub":"<uuid ученика>","role":"authenticated"}', true);
-- select public.preview_task_verdict('<uuid задачи>', '12');   -- ERROR: STAFF_ONLY
-- rollback;
--
-- begin;
-- -- 2. Преподаватель (строка teachers): true/false по эталону задачи, в
-- --    test_variant_answers ничего не появилось.
-- select set_config('role', 'authenticated', true);
-- select set_config('request.jwt.claims', '{"sub":"<uuid преподавателя>","role":"authenticated"}', true);
-- select public.preview_task_verdict('<uuid задачи первой части>', '<её ответ>');  -- true
-- select public.preview_task_verdict('<uuid задачи первой части>', 'мимо');        -- false
-- select public.preview_task_verdict('<uuid задачи второй части>', 'что угодно');  -- null
-- rollback;
--
-- Ловушки §29.4: set_config и проверяемая функция — отдельными операторами;
-- проба под владельцем таблиц RLS не проверяет.
