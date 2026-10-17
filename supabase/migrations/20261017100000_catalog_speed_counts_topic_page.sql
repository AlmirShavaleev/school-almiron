-- Каталог быстрее (владелец 16.10: «каталог очень долго грузится»).
-- Применяет оркестратор на сервер после «да» владельца, целиком, одной
-- транзакцией. Добавляет таблицы и функции, ЗАМЕНЯЕТ три функции счётчиков
-- (тот же ответ, то же имя и сигнатура) и вставкой по якорю меняет
-- catalog_my_overview (процентиль «больше, чем N % школы» — из готовой таблицы).
--
-- Было (RUM 3 дня, база после §292-perf): LCP страницы темы p50 2,5 с, p90
-- 13,7 с; get_catalog_section_task_counts_by_source ≈ 350 мс,
-- get_catalog_topic_counts_by_source ≈ 55–80 мс, get_catalog_section_topic_tree
-- ≈ 16–25 мс; страница темы — ~8 видов запросов, задачи/ассеты/прогресс/тексты
-- пачками по 50 (тема на 150 задач — 15–20 запросов).
--
-- Стало:
--   1. Счётчики «задач в теме/разделе» — заранее, в таблицах; пересчёт —
--      catalog_counts_refresh() (после загрузки/правки каталога её зовёт
--      загрузчик) + pg_cron раз в ночь. Функции счётчиков читают таблицу; своё
--      «решено» — по своим строкам catalog_task_progress (их у ученика сотни,
--      не тысячи). Замки §292 и «режим работы» — поверх готовых чисел.
--   2. catalog_topic_page(тема, …) — страница темы одним запросом: порция
--      задач (условие, рисунки, «выполнено», ответ/разбор по правилу
--      catalog_task_texts) + счётчики темы; фильтры «сделано / не сделано» и
--      сложность — на сервере; следующая порция — тот же вызов со сдвигом.
--   3. «Больше, чем N % школы» — решённое каждым учеником по экзаменам
--      считается раз в ночь (catalog_school_solved); витрина только читает.
--
-- Источник тел заменяемых функций: репозиторий (миграции 20260802223053,
-- 20260802233810) и сервер на 15.10 (catalog_my_overview с вставкой §292).
-- Перед заменой — проверка, что тела на сервере такие же (по фрагментам);
-- иначе ошибка и откат всего файла.

begin;
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Проверка: тела на сервере — те, от которых считались новые
-- ─────────────────────────────────────────────────────────────────────────

do $check$
declare
  d text;
begin
  d := pg_get_functiondef('public.get_catalog_section_topic_tree(uuid)'::regprocedure);
  if strpos(d, 'catalog_exam_topic_counts') = 0 and strpos(d, 'is distinct from ''ai_physics_v1''') = 0 then
    raise exception 'catalog_speed: get_catalog_section_topic_tree на сервере не как в 20260802223053 — сверить вручную';
  end if;
  d := pg_get_functiondef('public.get_catalog_topic_counts_by_source(text, text, text)'::regprocedure);
  if strpos(d, 'catalog_source_topic_counts') = 0 and strpos(d, 'and tt.is_primary') = 0 then
    raise exception 'catalog_speed: get_catalog_topic_counts_by_source на сервере не как в 20260802233810 — сверить вручную';
  end if;
  d := pg_get_functiondef('public.get_catalog_section_task_counts_by_source(text, text, text)'::regprocedure);
  if strpos(d, 'catalog_source_section_counts') = 0 and strpos(d, 'grouping sets ((l.section_id), ())') = 0 then
    raise exception 'catalog_speed: get_catalog_section_task_counts_by_source на сервере не как в 20260802233810 — сверить вручную';
  end if;
end $check$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Готовые счётчики
-- ─────────────────────────────────────────────────────────────────────────

-- Экзаменационный вид: задачи темы в разделе (связи кроме ai_physics_v1).
create table if not exists public.catalog_exam_topic_counts (
  section_id uuid not null,
  topic_id   uuid not null,
  task_count int  not null,
  primary key (section_id, topic_id)
);

-- Вид по источнику («Физические темы»): основная тема задачи (is_primary).
create table if not exists public.catalog_source_topic_counts (
  source     text not null,          -- '' = связи без источника
  subject    text not null,
  exam_type  text not null,
  topic_id   uuid not null,
  task_count int  not null,
  primary key (source, subject, exam_type, topic_id)
);

-- Разделы вида по источнику (родитель темы) и итог (section_id is null).
create table if not exists public.catalog_source_section_counts (
  source     text not null,
  subject    text not null,
  exam_type  text not null,
  section_id uuid,
  task_count int  not null
);
create unique index if not exists catalog_source_section_counts_key
  on public.catalog_source_section_counts (source, subject, exam_type, coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- «Больше, чем N % школы»: решённое каждым учеником по экзамену (раз в ночь).
create table if not exists public.catalog_school_solved (
  profile_id uuid not null,
  subject    text not null,
  exam_type  text not null,
  solved     int  not null,
  primary key (profile_id, subject, exam_type)
);

create table if not exists public.catalog_counts_meta (
  kind         text primary key,       -- counts | school
  refreshed_at timestamptz not null,
  rows         int not null
);

-- Читают только definer-функции.
alter table public.catalog_exam_topic_counts enable row level security;
alter table public.catalog_source_topic_counts enable row level security;
alter table public.catalog_source_section_counts enable row level security;
alter table public.catalog_school_solved enable row level security;
alter table public.catalog_counts_meta enable row level security;
revoke all on public.catalog_exam_topic_counts, public.catalog_source_topic_counts,
              public.catalog_source_section_counts, public.catalog_school_solved,
              public.catalog_counts_meta from anon, authenticated;

-- Пересчёт счётчиков задач. delete + insert в одной транзакции: читатели до
-- конца пересчёта видят прежние числа (MVCC). Зовёт загрузчик после заливки и
-- cron раз в ночь.
create or replace function public.catalog_counts_refresh()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_a int; v_b int; v_c int;
begin
  if auth.uid() is not null and not public.is_admin_or_owner() then
    raise exception 'Только администратор' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;

  delete from public.catalog_exam_topic_counts;
  insert into public.catalog_exam_topic_counts (section_id, topic_id, task_count)
  select t.section_id, tt.topic_id, count(distinct tt.task_id)::int
    from public.catalog_task_topics tt
    join public.catalog_tasks t on t.id = tt.task_id
   where t.is_published and tt.source is distinct from 'ai_physics_v1'
   group by t.section_id, tt.topic_id;
  get diagnostics v_a = row_count;

  delete from public.catalog_source_topic_counts;
  insert into public.catalog_source_topic_counts (source, subject, exam_type, topic_id, task_count)
  select coalesce(tt.source, ''), t.subject, t.exam_type, tt.topic_id, count(distinct tt.task_id)::int
    from public.catalog_task_topics tt
    join public.catalog_tasks t on t.id = tt.task_id
   where t.is_published and tt.is_primary and t.subject is not null and t.exam_type is not null
   group by coalesce(tt.source, ''), t.subject, t.exam_type, tt.topic_id;
  get diagnostics v_b = row_count;

  delete from public.catalog_source_section_counts;
  insert into public.catalog_source_section_counts (source, subject, exam_type, section_id, task_count)
  select coalesce(tt.source, ''), t.subject, t.exam_type, parent.id, count(distinct tt.task_id)::int
    from public.catalog_task_topics tt
    join public.catalog_topics leaf   on leaf.id = tt.topic_id
    join public.catalog_topics parent on parent.id = leaf.parent_id
    join public.catalog_tasks t       on t.id = tt.task_id
   where t.is_published and tt.is_primary and t.subject is not null and t.exam_type is not null
   group by grouping sets ((coalesce(tt.source, ''), t.subject, t.exam_type, parent.id),
                           (coalesce(tt.source, ''), t.subject, t.exam_type));
  get diagnostics v_c = row_count;

  insert into public.catalog_counts_meta (kind, refreshed_at, rows) values ('counts', now(), v_a + v_b + v_c)
  on conflict (kind) do update set refreshed_at = excluded.refreshed_at, rows = excluded.rows;
  return jsonb_build_object('exam_topic', v_a, 'source_topic', v_b, 'source_section', v_c);
end $$;

-- Решённое учениками школы по экзаменам — то же правило, что было в
-- catalog_my_overview (отметка «выполнено» + верный ответ варианта, замена
-- задачи §269 считается заменяющей).
create or replace function public.catalog_school_stats_refresh()
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if auth.uid() is not null and not public.is_admin_or_owner() then
    raise exception 'Только администратор' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  delete from public.catalog_school_solved;
  with sec as (
    select s.id, s.subject, s.exam_type
      from public.catalog_sections s
     where s.is_published and s.exam_number >= 1
  ),
  school_raw as (
    select p.user_id as profile_id, p.task_id
      from public.catalog_task_progress p
     where p.is_completed
    union
    select st.profile_id, i.task_id
      from public.test_variant_answers a
      join public.test_variant_student_assignments sa on sa.id = a.student_assignment_id
      join public.students st on st.id = sa.student_id
      join public.test_variant_items i on i.id = a.variant_item_id
     where a.is_correct
  )
  insert into public.catalog_school_solved (profile_id, subject, exam_type, solved)
  select r.profile_id, s.subject, s.exam_type, count(distinct coalesce(t.replaced_by_task_id, r.task_id))::int
    from school_raw r
    join public.profiles pr on pr.id = r.profile_id and pr.role = 'student'
    join public.catalog_tasks t on t.id = r.task_id and (t.is_published or t.replaced_by_task_id is not null)
    join sec s on s.id = t.section_id
   group by r.profile_id, s.subject, s.exam_type;
  get diagnostics v_n = row_count;
  insert into public.catalog_counts_meta (kind, refreshed_at, rows) values ('school', now(), v_n)
  on conflict (kind) do update set refreshed_at = excluded.refreshed_at, rows = excluded.rows;
  return v_n;
end $$;

revoke all on function public.catalog_counts_refresh() from public, anon;
revoke all on function public.catalog_school_stats_refresh() from public, anon;
grant execute on function public.catalog_counts_refresh() to authenticated, service_role;
grant execute on function public.catalog_school_stats_refresh() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Функции счётчиков — тот же ответ из готовых таблиц
-- ─────────────────────────────────────────────────────────────────────────

-- Открыто ли пользователю: предмет по §292 и не «режим работы» (раньше это
-- делали RLS-политики catalog_tasks при invoker-функциях).
create or replace function public._catalog_counts_open(p_key text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and not public.work_mode_active() and public.catalog_key_allowed(p_key);
$$;
revoke all on function public._catalog_counts_open(text) from public, anon, authenticated;

create or replace function public.get_catalog_section_topic_tree(p_section_id uuid)
returns table (
  id              uuid,
  external_id     bigint,
  parent_id       uuid,
  title           text,
  slug            text,
  "position"      integer,
  task_count      bigint,
  completed_count bigint
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- готовые числа: catalog_exam_topic_counts
  with ok as (
    select public._catalog_counts_open(
             (select public.catalog_subject_key(cs.subject, cs.exam_type) from public.catalog_sections cs where cs.id = p_section_id)) as ok
  ),
  done as (
    select tt.topic_id, count(distinct ctp.task_id) as completed_count
      from public.catalog_task_progress ctp
      join public.catalog_tasks t on t.id = ctp.task_id and t.section_id = p_section_id and t.is_published
      join public.catalog_task_topics tt on tt.task_id = ctp.task_id and tt.source is distinct from 'ai_physics_v1'
     where ctp.user_id = auth.uid() and ctp.is_completed
     group by tt.topic_id
  )
  select tp.id, tp.external_id, tp.parent_id, tp.title, tp.slug, tp."position",
         c.task_count::bigint, coalesce(d.completed_count, 0)::bigint
    from public.catalog_exam_topic_counts c
    join public.catalog_topics tp on tp.id = c.topic_id
    left join done d on d.topic_id = c.topic_id
   where c.section_id = p_section_id and tp.is_published and (select ok from ok)
   order by tp."position";
$$;

create or replace function public.get_catalog_topic_counts_by_source(p_subject text, p_exam_type text, p_source text)
returns table (topic_id uuid, task_count bigint, completed_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- готовые числа: catalog_source_topic_counts
  with ok as (select public._catalog_counts_open(public.catalog_subject_key(p_subject, p_exam_type)) as ok),
  done as (
    select tt.topic_id, count(distinct ctp.task_id) as c
      from public.catalog_task_progress ctp
      join public.catalog_task_topics tt on tt.task_id = ctp.task_id
                                        and tt.source is not distinct from p_source and tt.is_primary
      join public.catalog_tasks t on t.id = ctp.task_id
                                 and t.subject = p_subject and t.exam_type = p_exam_type and t.is_published
     where ctp.user_id = auth.uid() and ctp.is_completed
     group by tt.topic_id
  )
  select c.topic_id, c.task_count::bigint, coalesce(d.c, 0)::bigint
    from public.catalog_source_topic_counts c
    left join done d on d.topic_id = c.topic_id
   where c.source = coalesce(p_source, '') and c.subject = p_subject and c.exam_type = p_exam_type
     and (select ok from ok);
$$;

create or replace function public.get_catalog_section_task_counts_by_source(p_subject text, p_exam_type text, p_source text)
returns table (section_id uuid, task_count bigint, completed_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- готовые числа: catalog_source_section_counts
  with ok as (select public._catalog_counts_open(public.catalog_subject_key(p_subject, p_exam_type)) as ok),
  my as (
    select distinct parent.id as section_id, ctp.task_id
      from public.catalog_task_progress ctp
      join public.catalog_task_topics tt on tt.task_id = ctp.task_id
                                        and tt.source is not distinct from p_source and tt.is_primary
      join public.catalog_topics leaf   on leaf.id = tt.topic_id
      join public.catalog_topics parent on parent.id = leaf.parent_id
      join public.catalog_tasks t on t.id = ctp.task_id
                                 and t.subject = p_subject and t.exam_type = p_exam_type and t.is_published
     where ctp.user_id = auth.uid() and ctp.is_completed
  ),
  done as (
    select m.section_id, count(distinct m.task_id) as c from my m group by grouping sets ((m.section_id), ())
  ),
  rows_ as (
    select c.section_id, c.task_count::bigint as task_count, coalesce(d.c, 0)::bigint as completed_count
      from public.catalog_source_section_counts c
      left join done d on d.section_id is not distinct from c.section_id
     where c.source = coalesce(p_source, '') and c.subject = p_subject and c.exam_type = p_exam_type
       and (select ok from ok)
  )
  select * from rows_
  union all
  -- как прежде (grouping sets): строка-итог есть всегда, и на пустом — нули
  select null::uuid, 0::bigint, 0::bigint where not exists (select 1 from rows_ r where r.section_id is null);
$$;

revoke all on function public.get_catalog_section_topic_tree(uuid) from public, anon;
revoke all on function public.get_catalog_topic_counts_by_source(text, text, text) from public, anon;
revoke all on function public.get_catalog_section_task_counts_by_source(text, text, text) from public, anon;
grant execute on function public.get_catalog_section_topic_tree(uuid) to authenticated, service_role;
grant execute on function public.get_catalog_topic_counts_by_source(text, text, text) to authenticated, service_role;
grant execute on function public.get_catalog_section_task_counts_by_source(text, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Страница темы одним запросом
-- ─────────────────────────────────────────────────────────────────────────

-- p_source: null — экзаменационный вид (связи кроме ai_physics_v1, как
--   get_catalog_section_topic_tree); иначе — вид по источнику, только основная
--   тема задачи (как get_catalog_topic_counts_by_source).
-- p_filter: all | done | todo; p_difficulties: null или {} — все.
-- p_order: null — по виду (экзамен: position; источник: лёгкая → сложная,
--   потом position — как сортировал клиент); 'position' | 'difficulty'.
-- Ответ: { total, done, by_difficulty, filtered, offset, limit, tasks[] }.
--   tasks[]: колонки строки задачи (как TASK_ROW_SELECT клиента) + is_completed
--   + assets[] + texts (строка catalog_task_texts — то же правило §262).
--   answer_spec не отдаётся.
-- Закрыто по подписке (§292): тема с задачами, из которых не открыто ни одной,
--   — ошибка CATALOG_LOCKED. Режим работы — пустой ответ (как RLS).
create or replace function public.catalog_topic_page(
  p_topic_id     uuid,
  p_source       text default null,
  p_filter       text default 'all',
  p_difficulties text[] default null,
  p_order        text default null,
  p_offset       int default 0,
  p_limit        int default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed uuid[];
  v_filter  text := coalesce(nullif(p_filter, ''), 'all');
  v_diff    text[] := case when cardinality(p_difficulties) > 0 then p_difficulties end;
  v_by_diff boolean := coalesce(p_order, case when p_source is null then 'position' else 'difficulty' end) = 'difficulty';
  v_limit   int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_stats   jsonb;
  v_page    uuid[];
  v_done    uuid[];
  v_texts   jsonb := '{}'::jsonb;
  v_tasks   jsonb;
begin
  if v_uid is null then
    raise exception 'catalog_topic_page: нужен вход' using errcode = '42501';
  end if;
  if v_filter not in ('all', 'done', 'todo') then
    raise exception 'catalog_topic_page: фильтр all | done | todo' using errcode = '22023';
  end if;
  if public.work_mode_active() then
    -- как RLS catalog_tasks_work_mode: во время работы каталог пуст
    return jsonb_build_object('total', 0, 'done', 0, 'by_difficulty', '{}'::jsonb, 'filtered', 0,
                              'offset', v_offset, 'limit', v_limit, 'tasks', '[]'::jsonb, 'work_mode', true);
  end if;
  v_allowed := public.catalog_allowed_sections();   -- null — открыто всё

  -- 1. Задачи темы: счётчики, порция (id по порядку) и «выполнено» в порции
  with links as (
    select distinct tt.task_id
      from public.catalog_task_topics tt
     where tt.topic_id = p_topic_id
       and case when p_source is null then tt.source is distinct from 'ai_physics_v1'
                else tt.source = p_source and tt.is_primary end
  ),
  base as materialized (
    select t.id, t.position as pos, t.external_id as ext, t.difficulty,
           (p.task_id is not null) as is_completed,
           case t.difficulty when 'лёгкая' then 0 when 'средняя' then 1 when 'сложная' then 2 else 3 end as rk
      from links l
      join public.catalog_tasks t on t.id = l.task_id and t.is_published
      left join public.catalog_task_progress p on p.user_id = v_uid and p.task_id = t.id and p.is_completed
     where v_allowed is null or t.section_id = any (v_allowed)
  ),
  f as (
    select b.* from base b
     where (v_filter = 'all' or (v_filter = 'done') = b.is_completed)
       and (v_diff is null or b.difficulty = any (v_diff))
  ),
  pg as (
    select f.id, f.is_completed,
           row_number() over (order by case when v_by_diff then f.rk else 0 end, f.pos, f.ext, f.id) as o
      from f
     order by o
    offset v_offset limit v_limit
  )
  select jsonb_build_object(
           'total',         (select count(*) from base),
           'done',          (select count(*) from base where is_completed),
           'by_difficulty', coalesce((select jsonb_object_agg(x.d, x.n)
                                        from (select coalesce(difficulty, '') d, count(*) n from base group by 1) x), '{}'::jsonb),
           'filtered',      (select count(*) from f)),
         coalesce((select array_agg(pg.id order by pg.o) from pg), '{}'::uuid[]),
         coalesce((select array_agg(pg.id) from pg where pg.is_completed), '{}'::uuid[])
    into v_stats, v_page, v_done;

  if (v_stats ->> 'total')::int = 0 and v_allowed is not null and exists (
       select 1 from public.catalog_task_topics tt join public.catalog_tasks t on t.id = tt.task_id and t.is_published
        where tt.topic_id = p_topic_id
          and case when p_source is null then tt.source is distinct from 'ai_physics_v1'
                   else tt.source = p_source and tt.is_primary end) then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;

  -- 2. Порция: строки задач, рисунки, тексты по правилу §262
  if cardinality(v_page) > 0 then
    select coalesce(jsonb_object_agg(x.task_id, to_jsonb(x)), '{}'::jsonb) into v_texts
      from public.catalog_task_texts(v_page) x;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'external_id', t.external_id, 'section_id', t.section_id,
           'subject', t.subject, 'exam_type', t.exam_type, 'difficulty', t.difficulty,
           'statement_html', t.statement_html, 'has_answer', t.has_answer, 'has_solution', t.has_solution,
           'max_points', t.max_points, 'position', t.position, 'exam_part', t.exam_part,
           'is_completed', t.id = any (v_done),
           'assets', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', a.id, 'tex_session_id', a.tex_session_id, 'kind', a.kind,
                                 'storage_path', a.storage_path, 'alt', a.alt, 'position', a.position)
                               order by a.position)
                                 from public.catalog_task_assets a where a.task_id = t.id), '[]'::jsonb),
           'texts', v_texts -> t.id::text)
         order by array_position(v_page, t.id)), '[]'::jsonb)
    into v_tasks
    from public.catalog_tasks t
   where t.id = any (v_page);

  return v_stats || jsonb_build_object('offset', v_offset, 'limit', v_limit, 'tasks', v_tasks);
end $$;

revoke all on function public.catalog_topic_page(uuid, text, text, text[], text, int, int) from public, anon;
grant execute on function public.catalog_topic_page(uuid, text, text, text[], text, int, int) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Витрина: процентиль школы — из catalog_school_solved (вставка по якорю
--    в тело с сервера; своё решённое по-прежнему живое)
-- ─────────────────────────────────────────────────────────────────────────

do $patch$
declare
  d      text;
  i      int;
  j      int;
  c_end1 constant text := E'  per_exam as (\n    select profile_id, subject, exam_type, count(distinct task_id)::int as solved\n      from school\n     group by profile_id, subject, exam_type\n  ),\n';
  c_all  constant text := E'  per_all as (\n    select profile_id, count(distinct task_id)::int as solved\n      from school\n     group by profile_id\n  ),\n';
begin
  d := pg_get_functiondef('public.catalog_my_overview()'::regprocedure);
  if strpos(d, 'catalog_school_solved') > 0 then
    raise notice 'catalog_speed: catalog_my_overview уже читает catalog_school_solved — пропуск';
    return;
  end if;
  i := strpos(d, E'  school_raw as (\n');
  j := strpos(d, c_end1);
  if i = 0 or j = 0 or j < i
     or (length(d) - length(replace(d, c_end1, ''))) / length(c_end1) <> 1
     or (length(d) - length(replace(d, c_all, ''))) / length(c_all) <> 1 then
    raise exception 'catalog_speed: в catalog_my_overview не найдены блоки school_raw…per_exam / per_all — сверить вручную';
  end if;
  d := left(d, i - 1)
    || E'  -- решённое учениками школы — раз в ночь (catalog_school_stats_refresh)\n'
    || E'  per_exam as (\n'
    || E'    select c.profile_id, c.subject, c.exam_type, c.solved\n'
    || E'      from public.catalog_school_solved c\n'
    || E'      join my_exams e on e.subject = c.subject and e.exam_type = c.exam_type\n'
    || E'     where v_is_student\n'
    || E'  ),\n'
    || substr(d, j + length(c_end1));
  d := replace(d, c_all,
       E'  per_all as (\n'
    || E'    select pe.profile_id, sum(pe.solved)::int as solved\n'
    || E'      from per_exam pe\n'
    || E'     group by pe.profile_id\n'
    || E'  ),\n');
  execute d;
end $patch$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Первый расчёт и ночной пересчёт (03:30 МСК)
-- ─────────────────────────────────────────────────────────────────────────

select public.catalog_counts_refresh();
select public.catalog_school_stats_refresh();
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('catalog-counts-refresh', '30 0 * * *',
      'select public.catalog_counts_refresh(); select public.catalog_school_stats_refresh();');
  else
    raise notice 'catalog_speed: pg_cron нет — ночной пересчёт не поставлен, звать функции вручную';
  end if;
end $cron$;

commit;
