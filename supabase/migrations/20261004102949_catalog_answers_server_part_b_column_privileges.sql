-- §262b. Применено оркестратором 04.10 (MCP apply_migration, версия 20261004102949) после подтверждения нового клиента на проде; применённый текст — без строк-комментариев. Пробы 3 на проде пройдены.
-- §262, шаг 2 из 2 (262b). Закрытие колонок ответа catalog_tasks для anon / authenticated.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор ТОЛЬКО ПОСЛЕ выкладки клиента §262 (порядок: 262a → клиент → 262b),
-- одной транзакцией MCP apply_migration; файл затем называется по версии из schema_migrations.
-- ПЕРЕД применением — проба «что сломается» из PROJECT_STATE.md §262 (пробы для прода, шаг 2.0):
-- invoker-функции, представления, политики и публикация realtime, читающие колонки ответа.
-- Повторяемая: ALTER FUNCTION … SECURITY DEFINER и REVOKE/GRANT идемпотентны. Ни одного drop.
--
-- Вариант выбран: ПРАВА НА КОЛОНКИ (revoke select на таблицу + grant select на все колонки, кроме четырёх
-- секретных). Почему не отдельная таблица catalog_task_secrets с триггером и обнулением колонок:
--   * ~15 definer-функций прода читают ct.answer_html напрямую (catalog_check_answer, submit_variant,
--     generate_variant_tasks, get_variant_items_for_student, topic_test_add_item, answer_topic_task, …) —
--     обнуление колонок потребовало бы переписать каждую, и пропуск одной молча ломает проверку ответов;
--   * импорт-скрипты (.env.import.local — сервисный ключ) и правка каталога пишут в catalog_tasks как есть;
--     права на колонки сервисной роли и владельцу не мешают, триггер синхронизации не нужен;
--   * обратимо одной строкой: grant select on public.catalog_tasks to authenticated.
-- Цена варианта: (1) прямые чтения ответа персоналом тоже закрываются — клиент §262 уже ходит через
-- catalog_task_texts (персоналу она отдаёт всё); (2) `select *` / `select=*` по catalog_tasks у
-- authenticated теперь отказ — в клиенте §262 таких запросов нет; (3) invoker-функции, читающие
-- колонки ответа под вызывающим, перестали бы работать — ниже они переводятся в security definer.
--
-- Что НЕ меняется: строки (RLS catalog_tasks_select_auth как была), insert/update/delete-права, права
-- service_role и владельца, все definer-функции (§256 check/reveal/задача дня, варианты, тесты, задачи урока).

do $$
declare
  v_secret   text[] := array['answer_html', 'solution_html', 'solution_plan_html', 'grade_criteria_html'];
  v_sig      text;
  v_bad      text;
  v_cols     text;
begin
  -- ── 1. Invoker-функции, которые читают ответ под вызывающим и исполнимы authenticated → definer ──────
  -- Список — по миграциям репозитория (последние редакции). У всех уже `set search_path` (to '' или
  -- public, pg_temp), фильтр is_published — в теле; права выполнения не меняются.
  --   catalog_tasks_attach_preview  — 20260912213207 (персонал, состав отобранного)
  --   preview_task_verdict          — 20260915082230 (внутри проверка STAFF_ONLY)
  --   generate_variant_tasks_by_topic, variant_selection_availability — 20260803101106
  --   variant_topic_availability    — 20260803101106
  --   topic_catalog_part1_task_count — 20260809110527
  --   variant_section_available_counts — 20260812214736
  -- Нет функции на базе — пропускается (to_regprocedure = null).
  foreach v_sig in array array[
    'public.catalog_tasks_attach_preview(uuid[])',
    'public.preview_task_verdict(uuid, text)',
    'public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text)',
    'public.variant_selection_availability(text, text, uuid[], text)',
    'public.variant_topic_availability(text, text, uuid[], text)',
    'public.topic_catalog_part1_task_count(uuid[], text)',
    'public.variant_section_available_counts(text, text)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format('alter function %s security definer', v_sig);
    end if;
  end loop;

  -- ── 2. Страховка: ещё какая-то invoker-функция читает ответ — НЕ закрываем, а падаем ─────────────────
  -- (иначе она молча начнёт отвечать «permission denied for table catalog_tasks»). Критерий: схема public,
  -- security invoker, исполнима anon/authenticated, в теле catalog_tasks и секретная колонка или «*» строки.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not p.prosecdef
     and p.prokind in ('f', 'p')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and p.prosrc ~* 'catalog_tasks'
     and p.prosrc ~* '(answer_html|solution_html|solution_plan_html|grade_criteria_html|ct\.\*|catalog_tasks\.\*|select\s+\*\s+(into\s+\w+\s+)?from\s+(public\.)?catalog_tasks|catalog_tasks%rowtype)';
  if v_bad is not null then
    raise exception '262b: invoker-функции читают колонки ответа catalog_tasks: % — перевести в security definer (или переписать) и повторить', v_bad;
  end if;

  -- Политики других таблиц, которые в условии читают колонки ответа, после закрытия упадут — тоже стоп.
  select string_agg(format('%I.%I', pol.tablename, pol.policyname), ', ') into v_bad
    from pg_policies pol
   where pol.schemaname = 'public'
     and coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~* 'catalog_tasks'
     and coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~* '(answer_html|solution_html|solution_plan_html|grade_criteria_html)';
  if v_bad is not null then
    raise exception '262b: политики читают колонки ответа: %', v_bad;
  end if;

  -- Представления работают с правами владельца: закрытие колонок их НЕ закрывает. Представление, которое
  -- отдаёт ответ catalog_tasks и читается authenticated/anon, — утечка мимо 262b: стоп.
  select string_agg(format('%I.%I', c.relnamespace::regnamespace::text, c.relname), ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))
     and pg_get_viewdef(c.oid) ~* 'catalog_tasks'
     and pg_get_viewdef(c.oid) ~* '(answer_html|solution_html|solution_plan_html|grade_criteria_html)';
  if v_bad is not null then
    raise exception '262b: представления отдают колонки ответа catalog_tasks: %', v_bad;
  end if;

  -- ── 3. Права на колонки ────────────────────────────────────────────────────────────────────────────
  -- REVOKE на таблицу снимает и права на колонки (повторный запуск начинает с чистого листа). Список
  -- открытых колонок — все текущие колонки таблицы, кроме секретных (колонка, добавленная на проде мимо
  -- репозитория, остаётся читаемой; новая колонка ПОСЛЕ 262b закрыта до явного grant — это осознанно).
  revoke select on table public.catalog_tasks from public, anon, authenticated;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.catalog_tasks'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname <> all (v_secret);
  execute format('grant select (%s) on table public.catalog_tasks to authenticated', v_cols);
  -- anon: RLS catalog_tasks_select_auth (auth.uid() is not null) и так не отдаёт ему ни строки — колонки
  -- ему не возвращаются вовсе.
end $$;
