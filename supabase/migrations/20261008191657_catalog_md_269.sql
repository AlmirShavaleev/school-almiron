-- §269. Переписанный каталог физики ЕГЭ: задачи в Markdown + LaTeX, структурный ответ, новые строки вместо правки
-- задач из вариантов, рисунки в Supabase Storage. ТОЛЬКО ДОБАВЛЯЮЩАЯ; повторный прогон ничего не ломает
-- (колонки/ограничения/политики — «если нет», правки функций — по метке §269 в теле).
--
-- 1. catalog_tasks: content_format ('html' | 'md'), answer_spec (jsonb, ответ для проверки — колонка закрыта правами §262,
--    authenticated её не читает), origin_external_id (у скрытой старой строки — прежний номер задачи),
--    replaced_by_task_id (у скрытой старой строки — новая строка).
-- 2. Проверка ответа по answer_spec: catalog_answer_spec_verdict (число с допуском, десятичная запятая, «−»; цифры,
--    в т. ч. «в любом порядке» и «значение+погрешность» КИМ 19; слова без учёта регистра, пробелов и знаков) — в
--    catalog_check_answer (каталог, задача дня), submit_variant (варианты), answer_topic_task (задачи урока),
--    preview_task_verdict (предпросмотр учителя). Без answer_spec — всё как раньше.
-- 3. Допуск ответа персоналу: catalog_task_answer_specs (ученику — отказ).
-- 4. Задача из варианта не правится на месте: catalog_replace_task_v2 (только service_role, загрузчик) заводит новую
--    строку с новым текстом (тот же номер задачи, раздел, темы, позиция), старую скрывает из каталога
--    (is_published = false, номер + 10⁹·k) — варианты рисуют её по-прежнему.
-- 5. Скрытые старые строки читаются вошедшими (варианты учителя грузят задачи напрямую), а история ученика по ним
--    (баллы школы, решённые, прогноз) засчитывается за новую строку.
-- 6. Бакет рисунков catalog-figures (публичный; пишут загрузчик и админ платформы).

-- ── 1. Колонки ───────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.catalog_tasks add column if not exists content_format text not null default 'html';
alter table public.catalog_tasks add column if not exists answer_spec jsonb;
alter table public.catalog_tasks add column if not exists origin_external_id bigint;
alter table public.catalog_tasks add column if not exists replaced_by_task_id uuid;

comment on column public.catalog_tasks.content_format is
  '§269: формат statement_html/solution_html: html (как было) или md (Markdown + LaTeX, текст начинается с <!--md-->).';
comment on column public.catalog_tasks.answer_spec is
  '§269: ответ для проверки: {type:number,value,tol} | {type:digits,text,any_order} | {type:text,text}. Закрыт правами (§262).';
comment on column public.catalog_tasks.origin_external_id is
  '§269: у скрытой старой строки (замена задачи из варианта) — прежний номер задачи; сам external_id сдвинут на 10^9·k.';
comment on column public.catalog_tasks.replaced_by_task_id is
  '§269: у скрытой старой строки — строка, которая заменила её в каталоге. Варианты по-прежнему ссылаются на старую.';

create or replace function public.catalog_answer_spec_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when p->>'type' = 'number' then
      case when coalesce(p->>'value', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
             and coalesce(jsonb_typeof(p->'tol'), 'null') in ('number', 'null')
           then coalesce((p->>'tol')::numeric, 0) >= 0
           else false end
    when p->>'type' = 'digits' then
      coalesce(p->>'text', '') ~ '^[0-9]+(,[0-9]+)*$'
      and coalesce(jsonb_typeof(p->'any_order'), 'null') in ('boolean', 'null')
    when p->>'type' = 'text' then btrim(coalesce(p->>'text', '')) <> ''
    else false
  end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_tasks'::regclass and conname = 'catalog_tasks_content_format_check') then
    alter table public.catalog_tasks add constraint catalog_tasks_content_format_check check (content_format in ('html', 'md'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_tasks'::regclass and conname = 'catalog_tasks_answer_spec_check') then
    alter table public.catalog_tasks add constraint catalog_tasks_answer_spec_check
      check (answer_spec is null or public.catalog_answer_spec_valid(answer_spec));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_tasks'::regclass and conname = 'catalog_tasks_replaced_by_task_id_fkey') then
    alter table public.catalog_tasks add constraint catalog_tasks_replaced_by_task_id_fkey
      foreign key (replaced_by_task_id) references public.catalog_tasks(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.catalog_tasks'::regclass and conname = 'catalog_tasks_replaced_by_not_self') then
    alter table public.catalog_tasks add constraint catalog_tasks_replaced_by_not_self
      check (replaced_by_task_id is null or replaced_by_task_id <> id);
  end if;
end $$;

create index if not exists catalog_tasks_replaced_by_idx
  on public.catalog_tasks (replaced_by_task_id) where replaced_by_task_id is not null;

-- Права колонок (§262: у authenticated — select только перечисленных колонок). answer_spec НЕ выдаётся.
grant select (content_format, origin_external_id, replaced_by_task_id) on public.catalog_tasks to authenticated;

-- ── 2. Проверка ответа по answer_spec ────────────────────────────────────────────────────────────────────────────
-- Слова: регистр, ё/е, пробелы и любые знаки не важны («к наблюдателю» = «Кнаблюдателю»). Кириллица переводится
-- в строчные явно — не зависит от локали базы.
create or replace function public.catalog_answer_text_key(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           lower(translate(coalesce(p_raw, ''),
                           'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё',
                           'абвгдеежзийклмнопрстуфхцчшщъыьэюяе')),
           '[^0-9a-zа-я]', '', 'g');
$$;

-- Число: autocheck_number_of (§266: запятая/точка, «−», «–», пробелы) и |ответ − эталон| ≤ tol.
-- Цифры: autocheck_digits_of (пробелы, запятые, точки между цифрами не важны), any_order — как набор.
-- «Значение+погрешность» («4,40,2», КИМ 19) — тем же правилом, что в вариантах (variant_answer_verdict).
create or replace function public.catalog_answer_spec_verdict(p_spec jsonb, p_raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_spec is null or btrim(coalesce(p_raw, '')) = '' then false
    when p_spec->>'type' = 'number' then
      coalesce(public.autocheck_answer_correct('number', (p_spec->>'value')::numeric,
                                               coalesce((p_spec->>'tol')::numeric, 0), null, false, p_raw), false)
    when p_spec->>'type' = 'digits' and coalesce(p_spec->>'text', '') ~ '^[0-9]+$' then
      coalesce(public.autocheck_answer_correct('digits', null, null, p_spec->>'text',
                                               coalesce((p_spec->>'any_order')::boolean, false), p_raw), false)
    when p_spec->>'type' = 'digits' then
      coalesce(public.variant_answer_verdict(public.normalize_variant_answer(p_spec->>'text'),
                                             public.normalize_variant_answer(p_raw)), false)
    when p_spec->>'type' = 'text' then
      public.catalog_answer_text_key(p_raw) <> ''
      and public.catalog_answer_text_key(p_raw) = public.catalog_answer_text_key(p_spec->>'text')
    else false
  end;
$$;

revoke all on function public.catalog_answer_spec_valid(jsonb) from public, anon;
revoke all on function public.catalog_answer_text_key(text) from public, anon;
revoke all on function public.catalog_answer_spec_verdict(jsonb, text) from public, anon, authenticated;
grant execute on function public.catalog_answer_spec_valid(jsonb) to authenticated, service_role;
grant execute on function public.catalog_answer_text_key(text) to authenticated, service_role;
grant execute on function public.catalog_answer_spec_verdict(jsonb, text) to service_role;

-- ── 3. Допуск ответа — персоналу ─────────────────────────────────────────────────────────────────────────────────
-- Персонал — как в catalog_answer_reasons (§262): profiles.role teacher/curator/admin/owner. Ученику — 42501.
create or replace function public.catalog_task_answer_specs(p_task_ids uuid[])
returns table (task_id uuid, answer_spec jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'catalog_task_answer_specs: нужен вход' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.id = v_uid and p.role in ('teacher', 'curator', 'admin', 'owner')) then
    raise exception 'STAFF_ONLY: эталон ответа с допуском видит только персонал' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_task_ids, '{}'::uuid[])) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;
  return query
    select ct.id, ct.answer_spec
      from public.catalog_tasks ct
     where ct.id = any (coalesce(p_task_ids, '{}'::uuid[]))
       and ct.answer_spec is not null;
end;
$$;

revoke all on function public.catalog_task_answer_specs(uuid[]) from public, anon;
grant execute on function public.catalog_task_answer_specs(uuid[]) to authenticated;

-- ── 4. Скрытые старые строки: видны вошедшим (варианты), но не в каталоге ────────────────────────────────────────
-- Список скрытых строк — отдельной функцией: в политике остаются только id и is_published (оба в индексе
-- catalog_tasks_counts_covering_idx), и подсчёты каталога (§268) не теряют index-only scan; IN (…) — один хэш на запрос.
create or replace function public.catalog_archived_task_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ct.id from public.catalog_tasks ct where ct.replaced_by_task_id is not null;
$$;

revoke all on function public.catalog_archived_task_ids() from public, anon;
grant execute on function public.catalog_archived_task_ids() to authenticated;

drop policy if exists catalog_tasks_select_archived on public.catalog_tasks;
create policy catalog_tasks_select_archived on public.catalog_tasks
  for select to authenticated
  using (((select auth.uid()) is not null) and not is_published and id in (select public.catalog_archived_task_ids()));

drop policy if exists catalog_task_assets_select_archived on public.catalog_task_assets;
create policy catalog_task_assets_select_archived on public.catalog_task_assets
  for select to authenticated
  using (((select auth.uid()) is not null) and task_id in (select public.catalog_archived_task_ids()));

-- ── 5. Замена задачи из варианта новой строкой (загрузчик, service_role) ────────────────────────────────────────
-- Одна транзакция: старая строка → скрыта (номер + 10⁹·k, origin_external_id, is_published = false), новая — с
-- прежним номером, разделом, позицией, частью, баллами, сложностью, критериями; темы копируются; подборки
-- (task_collection_items — не снимок) переводятся на новую строку; ранее скрытые копии этой задачи указывают на
-- новую. Варианты (test_variant_items), тесты тем (снимок), попытки/прогресс/раскрытия учеников остаются при старой.
-- Повтор по уже заменённой строке ничего не делает и возвращает прежнюю замену.
create or replace function public.catalog_replace_task_v2(p_old_task_id uuid, p_content jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old  public.catalog_tasks%rowtype;
  v_new  uuid;
  v_k    integer := 1;
  v_arch bigint;
begin
  select * into v_old from public.catalog_tasks where id = p_old_task_id for update;
  if not found then
    raise exception 'NOT_FOUND: задача % не найдена', p_old_task_id using errcode = 'P0002';
  end if;
  if v_old.replaced_by_task_id is not null then
    return jsonb_build_object('new_task_id', v_old.replaced_by_task_id, 'archived_external_id', v_old.external_id,
                              'created', false);
  end if;
  if coalesce(p_content->>'content_format', '') <> 'md'
     or coalesce(p_content->>'statement_html', '') = ''
     or not public.catalog_answer_spec_valid(p_content->'answer_spec') then
    raise exception 'BAD_CONTENT: нужны content_format = md, условие и верный answer_spec' using errcode = '22023';
  end if;

  loop
    v_arch := v_old.external_id + 1000000000::bigint * v_k;
    exit when not exists (select 1 from public.catalog_tasks t
                           where t.subject = v_old.subject and t.exam_type = v_old.exam_type and t.external_id = v_arch);
    v_k := v_k + 1;
  end loop;

  update public.catalog_tasks
     set external_id = v_arch,
         origin_external_id = coalesce(origin_external_id, v_old.external_id),
         is_published = false,
         updated_at = now()
   where id = v_old.id;

  insert into public.catalog_tasks (
    external_id, section_id, subject, exam_type, position, exam_part, max_points, partial_type, difficulty,
    source_url, grade_criteria_html, solution_plan_html, is_published,
    content_format, statement_html, solution_html, answer_html, answer_spec, has_answer, has_solution)
  values (
    v_old.external_id, v_old.section_id, v_old.subject, v_old.exam_type, v_old.position, v_old.exam_part,
    v_old.max_points, v_old.partial_type, v_old.difficulty,
    v_old.source_url, v_old.grade_criteria_html, null, true,
    'md', p_content->>'statement_html', p_content->>'solution_html', p_content->>'answer_html', p_content->'answer_spec',
    coalesce((p_content->>'has_answer')::boolean, true), coalesce((p_content->>'has_solution')::boolean, true))
  returning id into v_new;

  update public.catalog_tasks set replaced_by_task_id = v_new
   where id = v_old.id or replaced_by_task_id = v_old.id;

  insert into public.catalog_task_topics (task_id, topic_id, is_primary, source)
  select v_new, ctt.topic_id, ctt.is_primary, ctt.source
    from public.catalog_task_topics ctt where ctt.task_id = v_old.id
  on conflict do nothing;

  update public.task_collection_items set catalog_task_id = v_new where catalog_task_id = v_old.id;

  return jsonb_build_object('new_task_id', v_new, 'archived_external_id', v_arch, 'created', true);
end;
$$;

revoke all on function public.catalog_replace_task_v2(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.catalog_replace_task_v2(uuid, jsonb) to service_role;

-- ── 6. Бакет рисунков ────────────────────────────────────────────────────────────────────────────────────────────
-- Публичный (как catalog-assets): <img> без подписи ссылки, кэш на год, путь — по содержимому (sha-256).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-figures', 'catalog-figures', true, 2097152,
        array['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists catalog_figures_admin_write on storage.objects;
create policy catalog_figures_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalog-figures' and (select public.is_admin_or_owner()));
drop policy if exists catalog_figures_admin_update on storage.objects;
create policy catalog_figures_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'catalog-figures' and (select public.is_admin_or_owner()));
drop policy if exists catalog_figures_admin_delete on storage.objects;
create policy catalog_figures_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalog-figures' and (select public.is_admin_or_owner()));

-- ── 7. Правки функций по месту (тело берётся с базы, правится по образцам, метка §269 — защита от повтора) ──────
-- Образец, найденный не ровно ожидаемое число раз, останавливает миграцию целиком: тело на базе разошлось с тем,
-- под которое она собрана (§265 так же правит student_school_points_of).
create or replace function pg_temp.s269_patch(p_fn regprocedure, p_pats text[], p_reps text[], p_counts int[])
returns void
language plpgsql
as $f$
declare
  d text := pg_get_functiondef(p_fn);
  i int;
  n int;
begin
  if strpos(d, '§269') > 0 then
    raise notice '§269: % уже исправлена — пропуск', p_fn;
    return;
  end if;
  for i in 1 .. array_length(p_pats, 1) loop
    select count(*) into n from regexp_matches(d, p_pats[i], 'g');
    if n <> p_counts[i] then
      raise exception '§269: в % образец № % найден % раз(а), ожидалось % — миграцию надо пересобрать под тело на базе',
        p_fn, i, n, p_counts[i];
    end if;
    d := regexp_replace(d, p_pats[i], p_reps[i], 'g');
  end loop;
  if strpos(d, '§269') = 0 then
    raise exception '§269: % — метка не попала в тело', p_fn;
  end if;
  execute d;
end;
$f$;

select pg_temp.s269_patch('public.catalog_check_answer(uuid, text)'::regprocedure,
  array[
    'select ct\.id, ct\.answer_html, ct\.partial_type',
    'v_correct := public\.catalog_task_verdict\(v_task\.answer_html, v_task\.partial_type, v_answer\);'
  ],
  array[
    'select ct.id, ct.answer_html, ct.answer_spec /* §269 */, ct.partial_type',
    'v_correct := case when v_task.answer_spec is not null
                   then coalesce(public.catalog_answer_spec_verdict(v_task.answer_spec, v_answer), false)
                   else public.catalog_task_verdict(v_task.answer_html, v_task.partial_type, v_answer) end;'
  ],
  array[1, 1]);

select pg_temp.s269_patch('public.submit_variant(uuid)'::regprocedure,
  array[
    'ct\.answer_html, ct\.has_answer, ct\.partial_type',
    'ELSIF v_auto_check THEN'
  ],
  array[
    'ct.answer_html, ct.has_answer, ct.partial_type, ct.answer_spec',
    'ELSIF v_item.answer_spec IS NOT NULL THEN
      -- §269: ответ в answer_spec (число с допуском, слова) — правило catalog_answer_spec_verdict.
      v_is_correct    := COALESCE(public.catalog_answer_spec_verdict(v_item.answer_spec, v_student_norm), false);
      v_points_earned := CASE WHEN v_is_correct THEN v_item.points::numeric ELSE 0 END;
    ELSIF v_auto_check THEN'
  ],
  array[1, 1]);

select pg_temp.s269_patch('public.answer_topic_task(uuid, uuid, text)'::regprocedure,
  array[
    'SELECT ct\.answer_html, ct\.partial_type, tvi\.points,',
    'v_correct := COALESCE\(\s*public\.variant_answer_verdict\(\s*public\.normalize_variant_answer\(public\.strip_html_simple\(v_task\.answer_html\)\),\s*v_norm\),\s*false\);'
  ],
  array[
    'SELECT ct.answer_html, ct.partial_type, tvi.points, ct.answer_spec,',
    'v_correct := CASE WHEN v_task.answer_spec IS NOT NULL /* §269 */
    THEN COALESCE(public.catalog_answer_spec_verdict(v_task.answer_spec, p_answer_raw), false)
    ELSE COALESCE(
      public.variant_answer_verdict(
        public.normalize_variant_answer(public.strip_html_simple(v_task.answer_html)),
        v_norm),
      false) END;'
  ],
  array[1, 1]);

select pg_temp.s269_patch('public.preview_task_verdict(uuid, text)'::regprocedure,
  array[
    'v_partial_type text;',
    'select ct\.answer_html, ct\.partial_type\s+into v_answer_html, v_partial_type',
    'if not public\.variant_answer_is_auto_checkable\(v_answer_html, v_partial_type\) then'
  ],
  array[
    'v_partial_type text;
  v_spec         jsonb; -- §269',
    'select ct.answer_html, ct.partial_type, ct.answer_spec
    into v_answer_html, v_partial_type, v_spec',
    'if v_spec is not null then
    return coalesce(public.catalog_answer_spec_verdict(v_spec, p_answer_raw), false);
  end if;

  if not public.variant_answer_is_auto_checkable(v_answer_html, v_partial_type) then'
  ],
  array[1, 1, 1]);

select pg_temp.s269_patch('public.catalog_counted_solutions(uuid)'::regprocedure,
  array[
    'select distinct on \(a\.task_id\)(\s+)a\.task_id,',
    'join public\.catalog_tasks ct on ct\.id = a\.task_id and ct\.is_published',
    'order by a\.task_id, a\.created_at, a\.id'
  ],
  array[
    'select distinct on (coalesce(ct.replaced_by_task_id, a.task_id))\1coalesce(ct.replaced_by_task_id, a.task_id) /* §269: скрытая старая строка — за новую */,',
    'join public.catalog_tasks ct on ct.id = a.task_id and (ct.is_published or ct.replaced_by_task_id is not null)',
    'order by coalesce(ct.replaced_by_task_id, a.task_id), a.created_at, a.id'
  ],
  array[1, 1, 1]);

select pg_temp.s269_patch('public.student_school_points_of(uuid)'::regprocedure,
  array[
    'select vi\.task_id,(\s+)min\(coalesce\(a\.submitted_at',
    'join public\.catalog_tasks ct on ct\.id = vi\.task_id and ct\.is_published',
    'group by vi\.task_id'
  ],
  array[
    'select coalesce(ct.replaced_by_task_id, vi.task_id) as task_id /* §269 */,\1min(coalesce(a.submitted_at',
    'join public.catalog_tasks ct on ct.id = vi.task_id and (ct.is_published or ct.replaced_by_task_id is not null)',
    'group by coalesce(ct.replaced_by_task_id, vi.task_id)'
  ],
  array[1, 1, 1]);

select pg_temp.s269_patch('public.student_exam_evidence_rows(uuid, timestamp with time zone)'::regprocedure,
  array[
    'join public\.catalog_tasks ct on ct\.id = x\.task_id and ct\.is_published',
    'join public\.catalog_tasks ct on ct\.id = vi\.task_id and ct\.is_published'
  ],
  array[
    'join public.catalog_tasks ct on ct.id = x.task_id and (ct.is_published or ct.replaced_by_task_id is not null) /* §269 */',
    'join public.catalog_tasks ct on ct.id = vi.task_id and (ct.is_published or ct.replaced_by_task_id is not null)'
  ],
  array[1, 1]);

select pg_temp.s269_patch('public.catalog_my_overview()'::regprocedure,
  array[
    'join public\.catalog_tasks t on t\.id = r\.task_id and t\.is_published',
    'select r\.task_id, s\.subject, s\.exam_type, s\.n, min\(r\.at\) as at',
    'group by r\.task_id, s\.subject, s\.exam_type, s\.n',
    'select r\.profile_id, s\.subject, s\.exam_type, r\.task_id'
  ],
  array[
    'join public.catalog_tasks t on t.id = r.task_id and (t.is_published or t.replaced_by_task_id is not null)',
    'select coalesce(t.replaced_by_task_id, r.task_id) as task_id /* §269 */, s.subject, s.exam_type, s.n, min(r.at) as at',
    'group by coalesce(t.replaced_by_task_id, r.task_id), s.subject, s.exam_type, s.n',
    'select r.profile_id, s.subject, s.exam_type, coalesce(t.replaced_by_task_id, r.task_id) as task_id'
  ],
  array[2, 1, 1, 1]);

drop function pg_temp.s269_patch(regprocedure, text[], text[], int[]);
