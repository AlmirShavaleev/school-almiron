-- §290-A (часть 2) — демо = первые 2 урока раздела; банк задач только тем,
-- кому положено. МЕНЯЕТ СУЩЕСТВУЮЩЕЕ — запускает владелец в SQL Editor,
-- целиком, в спокойное время, ПОСЛЕ части 1 (PENDING_290_a_path.sql: там
-- catalog_access_ok()).
--
-- Для нынешних школьников — ничего:
--   • демо — только при подписке на курс в статусе 'trial'; у школьных курсов
--     тарифов и подписок нет. Кроме того _progress_state зовут только для
--     курсов 'progress' (сейчас таких нет);
--   • банк задач: catalog_access_ok() = true для персонала, для школьника (в
--     группе курса без тарифов), для ученика с подпиской/пробным и для ВСЕХ,
--     кому подписка ещё не открыта (режим тестировщиков). Сверка md5 до/после —
--     запрос в конце файла.
--
-- Демо работает в курсах 'progress': подписочный курс перед запуском
-- переводится в 'progress' кнопкой админа (admin_course_unlock_mode_set).

begin;
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. _progress_state: демо (тело — как в 20261012071100_progress_unlock_288a,
--    добавлены признак is_demo и ветка «демо» в open / open_reason)
-- ─────────────────────────────────────────────────────────────────────────

do $check$
declare d text := pg_get_functiondef('public._progress_state(uuid, uuid[])'::regprocedure);
begin
  if strpos(d, '(s.allowed and (s.anchor or s.prev_closed))') = 0
     or strpos(d, 'when s.prev_closed then ''prev_closed''') = 0
     or strpos(d, 'is_demo') > 0 then
    raise exception '§290-A: тело _progress_state на проде не как в §288a — сверить вручную';
  end if;
end $check$;

create or replace function public._progress_state(p_course_id uuid, p_student_ids uuid[])
returns table (
  student_id      uuid,
  topic_id        uuid,
  module_id       uuid,
  rn              int,
  closed          boolean,
  closed_at       timestamptz,
  open            boolean,
  open_reason     text,      -- manual | first2 | date | prev_closed | null
  autocheck_total int,
  autocheck_left  int,
  hw_state        text,      -- none | draft | submitted | returned | accepted (ДЗ второй части)
  percent         int,
  override_state  text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with t as (
    select tp.id as topic_id, tp.module_id, tp.available_from,
           (row_number() over (partition by tp.module_id order by tp.order_index, tp.id))::int as rn
      from public.topics tp
      join public.modules m on m.id = tp.module_id
     where m.course_id = p_course_id
  ),
  st as (
    select s.id as student_id, s.profile_id,
           -- §290: пробный период по подписке на этот курс — «демо»
           exists (select 1 from public.student_subscriptions ss
                    where ss.student_id = s.id and ss.course_id = p_course_id
                      and ss.status = 'trial' and ss.access_until > now()) as is_demo
      from public.students s
     where s.id = any (p_student_ids)
  ),
  tasks as (
    select k.id as task_id, k.topic_id from public.topic_autocheck_tasks k
     where k.topic_id in (select t.topic_id from t)
  ),
  -- по задаче: завершена (верно или 3 попытки) и когда
  ans as (
    select a.profile_id, a.task_id,
           (bool_or(a.is_correct) or count(*) >= 3) as done,
           max(a.created_at) as at
      from public.topic_autocheck_answers a
     where a.profile_id in (select st.profile_id from st)
       and a.task_id in (select tasks.task_id from tasks)
     group by a.profile_id, a.task_id
  ),
  ac as (
    select st.student_id, tasks.topic_id,
           count(*)::int as total,
           (count(*) filter (where not coalesce(ans.done, false)))::int as left_n,
           max(ans.at) filter (where ans.done) as at
      from st
      cross join tasks
      left join ans on ans.profile_id = st.profile_id and ans.task_id = tasks.task_id
     group by st.student_id, tasks.topic_id
  ),
  hw as (
    select h.id as homework_id, h.topic_id, h.autocheck, h.grade_scale, h.is_published
      from public.topic_homework h
     where h.topic_id in (select t.topic_id from t)
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.homework_id, a.student_id, a.id as attempt_id, a.status::text as status
      from public.topic_homework_attempts a
     where a.homework_id in (select hw.homework_id from hw)
       and a.student_id in (select st.student_id from st)
     order by a.homework_id, a.student_id, a.attempt_number desc, a.created_at desc
  ),
  acc_review as (
    -- последняя проверка принятой попытки: балл и время
    select distinct on (la.homework_id, la.student_id)
           la.homework_id, la.student_id, r.score, r.created_at as at
      from last_att la
      join public.topic_homework_reviews r on r.attempt_id = la.attempt_id
     where la.status = 'accepted'
     order by la.homework_id, la.student_id, r.created_at desc, r.id desc
  ),
  base as (
    select st.student_id, st.is_demo, t.topic_id, t.module_id, t.rn, t.available_from,
           coalesce(ac.total, 0) as ac_total,
           coalesce(ac.left_n, 0) as ac_left,
           ac.at as ac_at,
           -- ДЗ второй части: только опубликованное и не автопроверочное
           case when h2.homework_id is null then 'none'
                when la2.status is null then 'none'
                when la2.status = 'returned_for_revision' then 'returned'
                else la2.status end as hw_state,
           h2.homework_id is not null as has_hw2,
           rv2.at as hw2_at,
           -- % — балл ДЗ урока (любого: автопроверочного или второй части)
           case hx.grade_scale
             when 'hundred' then rvx.score
             when 'five' then rvx.score * 20
           end as percent,
           o.state as override_state
      from st
      cross join t
      left join ac on ac.student_id = st.student_id and ac.topic_id = t.topic_id
      left join hw h2 on h2.topic_id = t.topic_id and not coalesce(h2.autocheck, false) and h2.is_published
      left join last_att la2 on la2.homework_id = h2.homework_id and la2.student_id = st.student_id
      left join acc_review rv2 on rv2.homework_id = h2.homework_id and rv2.student_id = st.student_id
      left join hw hx on hx.topic_id = t.topic_id
      left join acc_review rvx on rvx.homework_id = hx.homework_id and rvx.student_id = st.student_id
      left join public.student_topic_overrides o on o.student_id = st.student_id and o.topic_id = t.topic_id
  ),
  cl as (
    select b.*,
           (b.ac_left = 0 and (not b.has_hw2 or b.hw_state = 'accepted')) as is_closed,
           -- «опора» — открыт сам по себе: отметка open, первые 2, наступила дата
           (coalesce(b.override_state = 'open', false) or b.rn <= 2
            or (b.available_from is not null and b.available_from <= current_date)) as anchor,
           b.override_state is distinct from 'closed' as allowed
      from base b
  ),
  -- Урок открывается «закрытием предыдущего», только если предыдущий был ОТКРЫТ
  -- и закрыт. Открытость рекурсивна, поэтому так: серия подряд идущих уроков,
  -- каждый закрыт и не закрыт вручную; в серии до предыдущего урока есть опора —
  -- значит, вся серия была открыта. Запертый пустой урок цепочку не продолжает.
  runs as (
    select c.*,
           not (c.is_closed and c.allowed) as brk,
           sum(case when c.is_closed and c.allowed then 0 else 1 end)
             over (partition by c.student_id, c.module_id order by c.rn rows unbounded preceding) as grp
      from cl c
  ),
  chained as (
    select r.*,
           bool_or(r.anchor and not r.brk)
             over (partition by r.student_id, r.module_id, r.grp order by r.rn rows unbounded preceding) as run_anchored
      from runs r
  ),
  seq as (
    select c.*,
           coalesce(lag(not c.brk and c.run_anchored)
                      over (partition by c.student_id, c.module_id order by c.rn), false) as prev_closed
      from chained c
  )
  select s.student_id, s.topic_id, s.module_id, s.rn,
         s.is_closed,
         case when s.is_closed then
           nullif(greatest(coalesce(s.ac_at, '-infinity'::timestamptz),
                           coalesce(s.hw2_at, '-infinity'::timestamptz)), '-infinity'::timestamptz)
         end,
         -- §290: в демо открыты строго первые 2 урока раздела — ни даты, ни
         -- прохождение, ни ручное «открыть» больше не открывают
         case when s.is_demo then s.allowed and s.rn <= 2
              else s.allowed and (s.anchor or s.prev_closed) end,
         case when not s.allowed then null
              when s.is_demo then case when s.rn <= 2 then 'first2' end
              when s.override_state = 'open' then 'manual'
              when s.rn <= 2 then 'first2'
              when s.available_from is not null and s.available_from <= current_date then 'date'
              when s.prev_closed then 'prev_closed'
         end,
         s.ac_total, s.ac_left, s.hw_state, s.percent, s.override_state
    from seq s;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Банк задач: ограничительная политика (сверх существующих разрешающих)
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists catalog_tasks_bank_access on public.catalog_tasks;
create policy catalog_tasks_bank_access on public.catalog_tasks
  as restrictive
  for select to authenticated
  using ((select public.catalog_access_ok()));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RPC банка (security definer — RLS не видят): проверка доступа первой
--    строкой после «нужен вход» / чтения роли. Ровно одно вхождение якоря,
--    иначе ошибка и откат всего файла. Уже вставленная проверка — пропуск.
-- ─────────────────────────────────────────────────────────────────────────

do $patch$
declare
  r       record;
  d       text;
  i       int;
  j       int;
  c_guard constant text := E'\n  if not public.catalog_access_ok() then\n'
    || E'    raise exception ''Банк задач откроется с подпиской или пробным периодом'' using errcode = ''42501'', hint = ''CATALOG_LOCKED'';\n'
    || E'  end if;';
  c_role  constant text := 'SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();';
begin
  for r in
    select * from (values
      ('public.catalog_check_answer(uuid, text)',            'login', 'catalog_check_answer'),
      ('public.catalog_my_overview()',                       'login', 'catalog_my_overview'),
      ('public.catalog_practice_state(uuid, uuid[])',        'login', 'catalog_practice_state'),
      ('public.catalog_reveal_answer(uuid)',                 'login', 'catalog_reveal_answer'),
      ('public.catalog_reveal_answers(uuid[])',              'login', 'catalog_reveal_answers'),
      ('public.catalog_task_texts(uuid[])',                  'login', 'catalog_task_texts'),
      ('public.student_daily_task(text)',                    'login', 'student_daily_task'),
      ('public.create_self_built_variant(text, text, text, public.variant_item_input[])', 'role', null),
      ('public.generate_variant_tasks(public.variant_section_input[])',                   'role', null),
      ('public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text)',         'role', null)
    ) as x(fn, kind, name)
  loop
    d := pg_get_functiondef(r.fn::regprocedure);
    continue when strpos(d, 'CATALOG_LOCKED') > 0;
    if r.kind = 'login' then
      declare a text := '''' || r.name || ': нужен вход'' using errcode = ''42501'';';
      begin
        if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
          raise exception '§290-A: в % ожидалось ровно одно «%» — сверить вручную', r.fn, a;
        end if;
        i := strpos(d, a);
        j := strpos(substr(d, i), 'end if;');
        if j = 0 then raise exception '§290-A: в % нет «end if;» после входа', r.fn; end if;
        i := i + j - 1 + length('end if;');
      end;
    else
      if (length(d) - length(replace(d, c_role, ''))) / length(c_role) <> 1 then
        raise exception '§290-A: в % ожидалось ровно одно «%» — сверить вручную', r.fn, c_role;
      end if;
      i := strpos(d, c_role) + length(c_role);
    end if;
    execute left(d, i - 1) || c_guard || substr(d, i);
  end loop;
end $patch$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Сверка ПОСЛЕ (отдельным запуском): ученики, которым банк закрыт. Пока
-- подписка в режиме тестировщиков, должно быть 0 строк (13.10: 0 из 64).
-- set_config — отдельным оператором внутри цикла (ловушка §29.4).
-- ─────────────────────────────────────────────────────────────────────────
-- do $v$
-- declare r record; v_closed text[] := '{}';
-- begin
--   for r in select id, email from public.profiles where role = 'student' order by id loop
--     perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
--     if not public.catalog_access_ok() then v_closed := v_closed || r.email; end if;
--   end loop;
--   raise notice 'банк закрыт: % — %', cardinality(v_closed), v_closed;
-- end $v$;
