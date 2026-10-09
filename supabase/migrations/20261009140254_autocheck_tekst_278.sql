-- §278. Задачи с автопроверкой — текстом (Markdown + формулы), а не картинками.
-- ПРИМЕНЕНО 09.10 через MCP (версия 20261009140254). В применённом теле нет строки «drop trigger if exists» — триггера ещё не было.
-- Решение владельца 09.10: «в задачах с автопроверкой до сих пор картинки» → показывать как каталог (§269).
--
-- Только добавляющая:
--  1. Две новые колонки: statement_md (условие), solution_md (решение с «Дано», шагами и ответом). NULL — как раньше,
--     сайт показывает SVG (statement_path / solution_path остаются и дальше обязательны — запасной показ).
--     Рисунки внутри текста — `![](fig:autocheck/<sha>.svg)` из публичного бакета catalog-figures (тот же рендер, что
--     у каталога §269: экранированный текст, KaTeX с trust:false, <img> только из бакета).
--  2. Права: statement_md читается так же, как statement_path (колоночный grant); solution_md напрямую не читается
--     никем, кроме персонала через RPC — ученику только через topic_autocheck_state и только когда задача закрыта.
--  3. topic_autocheck_state — те же поля + statement_md всегда, solution_md по тому же правилу, что solution_path.
--  4. topic_autocheck_set_text(topic, items) — загрузчик кладёт тексты по коду задачи в урок и его копии.
--  5. Новая копия задачи (импорт в классы, копирование курса) получает тексты от исходной задачи (source_task_id).

alter table public.topic_autocheck_tasks
  add column if not exists statement_md text check (statement_md is null or length(statement_md) <= 20000),
  add column if not exists solution_md  text check (solution_md  is null or length(solution_md)  <= 40000);

comment on column public.topic_autocheck_tasks.statement_md is '§278. Условие Markdown + LaTeX (рисунки — fig:autocheck/… из catalog-figures). NULL — показывается statement_path.';
comment on column public.topic_autocheck_tasks.solution_md  is '§278. Решение Markdown + LaTeX (Дано, шаги, ответ). Ученику — только через topic_autocheck_state после закрытия задачи.';

grant select (statement_md) on public.topic_autocheck_tasks to authenticated;

-- 3. Состояние урока для ученика/персонала: + statement_md, + solution_md (по правилу solution_path).
create or replace function public.topic_autocheck_state(p_topic_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_staff boolean;
  v_tasks jsonb;
  v_total integer;
  v_solved integer;
  v_closed integer;
begin
  if v_uid is null then
    raise exception 'Нужен вход' using errcode = '42501';
  end if;
  v_staff := public.topic_material_can_manage(p_topic_id);
  if not v_staff and not public.course_student_can_see_topic(p_topic_id) then
    raise exception 'Нет доступа к этому уроку' using errcode = '42501';
  end if;

  with t as (
    select k.*,
           coalesce((select count(*) from topic_autocheck_answers a
                      where a.task_id = k.id and a.profile_id = v_uid), 0)::int as used,
           exists (select 1 from topic_autocheck_answers a
                    where a.task_id = k.id and a.profile_id = v_uid and a.is_correct) as solved
      from topic_autocheck_tasks k
     where k.topic_id = p_topic_id
  ), s as (
    select t.*, (t.solved or t.used >= 3) as closed from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               s.id,
           'code',             s.code,
           'position',         s.position,
           'statement_path',   s.statement_path,
           'statement_md',     s.statement_md,
           'answer_type',      s.answer_type,
           'digits_any_order', s.digits_any_order,
           'unit',             s.unit,
           'attempts_used',    case when v_staff then 0 else s.used end,
           'attempts_left',    case when v_staff then 3 else greatest(3 - s.used, 0) end,
           'solved',           not v_staff and s.solved,
           'closed',           not v_staff and s.closed,
           'answers',          case when v_staff then '[]'::jsonb else coalesce((
                                 select jsonb_agg(jsonb_build_object('attempt_no', a.attempt_no,
                                                                     'answer', a.answer_raw,
                                                                     'correct', a.is_correct)
                                                  order by a.attempt_no)
                                   from topic_autocheck_answers a
                                  where a.task_id = s.id and a.profile_id = v_uid), '[]'::jsonb) end,
           'answer_value',     case when v_staff or s.closed then s.answer_value end,
           'answer_tol',       case when v_staff or s.closed then s.answer_tol end,
           'answer_text',      case when v_staff or s.closed then s.answer_text end,
           'solution_path',    case when v_staff or s.closed then s.solution_path end,
           'solution_md',      case when v_staff or s.closed then s.solution_md end
         ) order by s.position, s.code), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where not v_staff and s.solved)::int,
         count(*) filter (where not v_staff and s.closed)::int
    into v_tasks, v_total, v_solved, v_closed
    from s;

  return jsonb_build_object(
    'topic_id', p_topic_id,
    'is_staff', v_staff,
    'tasks',    v_tasks,
    'total',    v_total,
    'solved',   v_solved,
    'closed',   v_closed,
    'finished', not v_staff and v_total > 0 and v_closed = v_total,
    'grade',    case when not v_staff and v_total > 0 and v_closed = v_total
                     then round(100.0 * v_solved / v_total)::int end
  );
end $function$;

-- 4. Тексты задач урока по коду — в урок и во все его копии.
create or replace function public.topic_autocheck_set_text(p_topic_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role  text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_it    jsonb;
  v_n     integer := 0;
  v_cnt   integer;
  v_copies integer := 0;
begin
  if auth.uid() is null then
    if v_role not in ('service_role', '') then
      raise exception 'Нет прав' using errcode = '42501';
    end if;
  elsif not public.topic_material_can_manage(p_topic_id) then
    raise exception 'Нет прав на этот урок' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Нужен массив' using errcode = '22023';
  end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    update topic_autocheck_tasks k
       set statement_md = nullif(v_it ->> 'statement_md', ''),
           solution_md  = nullif(v_it ->> 'solution_md', ''),
           updated_at   = now()
     where (k.topic_id = p_topic_id
            or k.topic_id in (select ct.id from topics ct where ct.source_topic_id = p_topic_id))
       and k.code = v_it ->> 'code'
       and (k.statement_md, k.solution_md) is distinct from
           (nullif(v_it ->> 'statement_md', ''), nullif(v_it ->> 'solution_md', ''));
    get diagnostics v_cnt = row_count;
    v_n := v_n + v_cnt;
  end loop;

  select count(*) into v_copies from topics ct where ct.source_topic_id = p_topic_id;
  return jsonb_build_object('updated_rows', v_n, 'copies', v_copies,
    'with_text', (select count(*) from topic_autocheck_tasks where topic_id = p_topic_id and statement_md is not null),
    'total',     (select count(*) from topic_autocheck_tasks where topic_id = p_topic_id));
end $$;

revoke all on function public.topic_autocheck_set_text(uuid, jsonb) from public, anon;
grant execute on function public.topic_autocheck_set_text(uuid, jsonb) to authenticated, service_role;

-- 5. Новая копия задачи наследует тексты исходной.
create or replace function public.trg_topic_autocheck_text_from_source()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.source_task_id is not null and new.statement_md is null and new.solution_md is null then
    select s.statement_md, s.solution_md into new.statement_md, new.solution_md
      from topic_autocheck_tasks s where s.id = new.source_task_id;
  end if;
  return new;
end $$;

revoke all on function public.trg_topic_autocheck_text_from_source() from public, anon, authenticated;

create trigger topic_autocheck_text_from_source
  before insert on public.topic_autocheck_tasks
  for each row execute function public.trg_topic_autocheck_text_from_source();
