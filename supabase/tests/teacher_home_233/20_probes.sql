-- §233. Пробы главной преподавателя: teacher_home и remind_overdue_homework.
--
-- Каждая проба — отдельная подтранзакция, откатываемая исключением 'PROBE:%'.
-- Внутри: роль и claims — ОТДЕЛЬНЫМИ операторами (perform set_config, CLAUDE.md
-- §29.4), затем операторы пробы по одному через probe_val (invoker: под
-- authenticated). Оператор с приставкой «AS:<кто>:» сначала меняет вызывающего,
-- «SU:» выполняется владельцем базы: подвинуть время напоминания или заглянуть
-- в notification_queue, которую клиент не читает (RLS). Откат
-- возвращает и данные, и роль. В конце — «кто × действие → ожидаемо / факт».
\pset footer off
select set_config('request.jwt.claims', '{}', false) \g /dev/null

create temp table actors (who text primary key, uid uuid);
insert into actors values
 ('TA',  '33000000-0000-0000-0000-0000000000a1'),
 ('TB',  '33000000-0000-0000-0000-0000000000b1'),
 ('ADM', '33000000-0000-0000-0000-00000000000a'),
 ('CUR', '33000000-0000-0000-0000-0000000000c1'),
 ('SA1', '33000000-0000-0000-0000-000000000051');
grant select on actors to authenticated;

create temp table ids (k text primary key, v text);
insert into ids values
 ('CA', '33300000-0000-0000-0000-000000000001'), ('CB', '33300000-0000-0000-0000-000000000002'),
 ('CC', '33300000-0000-0000-0000-000000000003'), ('GA', '33400000-0000-0000-0000-000000000001'),
 ('SA1', '33200000-0000-0000-0000-000000000051'), ('SA2', '33200000-0000-0000-0000-000000000052'),
 ('SB1', '33200000-0000-0000-0000-000000000061'), ('T01', '33600000-0000-0000-0000-000000000001'),
 ('PSA1', '33000000-0000-0000-0000-000000000051'), ('TODAY', (now() at time zone 'Europe/Moscow')::date::text);

-- Короткие выражения над ответом функций.
\set H 'public.teacher_home()'
\set OVD '''select string_agg((e->>''''student_name'''') || ''''/'''' || (e->>''''title'''') || ''''/'''' || (e->>''''telegram''''), '''', '''' order by o) from jsonb_array_elements(public.teacher_home()->''''overdue'''') with ordinality x(e, o)'''
\set REM '''select format(''''sent=%s pairs=%s already=%s none=%s muted=%s'''', r->>''''sent'''', r->>''''pairs'''', r->>''''already'''', (select string_agg(x->>''''name'''', '''','''') from jsonb_array_elements(r->''''no_telegram'''') x), (select string_agg(x->>''''name'''', '''','''') from jsonb_array_elements(r->''''muted'''') x)) from public.remind_overdue_homework() r'''

create temp table probes (n serial, who text, action text, stmts text[], expected text, actual text);

insert into probes (who, action, stmts, expected) values
-- ── «Не сдали к сроку» ───────────────────────────────────────────────────
 ('TA', 'должники своего курса: свежий срок выше, без Telegram и с выключенными — помечены',
   array[:OVD], 'Сафин Данияр/Векторы/ok, Зиннатуллин Артур/Отбор корней/muted, Никитина Вера/Отбор корней/none, Сафин Данияр/Отбор корней/ok'),
 ('TA', 'срок ДЗ и «сегодня» — дни по Москве',
   array['select string_agg(distinct (({TODAY}::date - (e->>''due_date'')::date))::text, '','') from jsonb_array_elements(public.teacher_home()->''overdue'') e'], '1,2'),
 ('TA', 'сужение p_course_ids до чужого курса — ничего',
   array['select format(''overdue=%s groups=%s series=%s'', jsonb_array_length(h->''overdue''), jsonb_array_length(h->''groups''), jsonb_array_length(h->''series'')) from public.teacher_home(array[''{CB}''::uuid]) h'], 'overdue=0 groups=0 series=0'),
 ('CUR', 'куратор курса CA видит тех же должников (course_is_staff)',
   array['select jsonb_array_length(public.teacher_home()->''overdue'')::text'], '4'),
 ('TB', 'посторонний преподаватель: только свой курс CB',
   array['select format(''overdue=%s mock=%s series=%s groups=%s'', jsonb_array_length(h->''overdue''), jsonb_array_length(h->''mock_pending''), jsonb_array_length(h->''series''), h->''groups''->0->>''name'') from public.teacher_home() h',
         'select string_agg(e->>''student_name'', '','') from jsonb_array_elements(public.teacher_home()->''overdue'') e'], 'overdue=1 mock=0 series=0 groups=11Б ; Ученик Б'),
 ('ADM', 'владелец в режиме учителя (p_course_ids = свои): только группа владельца',
   array['select format(''%s / %s'', h->''groups''->0->>''name'', h->''overdue''->0->>''student_name'') from public.teacher_home(array[''{CC}''::uuid]) h'], 'Группа владельца / Ученик В'),
 ('SA1', 'ученик: пусто, без ошибки',
   array['select format(''overdue=%s groups=%s mock=%s upcoming=%s'', jsonb_array_length(h->''overdue''), jsonb_array_length(h->''groups''), jsonb_array_length(h->''mock_pending''), jsonb_array_length(h->''upcoming'')) from public.teacher_home() h'], 'overdue=0 groups=0 mock=0 upcoming=0'),
-- ── Пробники на проверке, ряды, ближайшее ───────────────────────────────
 ('TA', 'пробники на проверке: №3 — 3 работы (самая давняя — SA1), №4 идущий — 1 (сдал SA2)',
   array['select string_agg(format(''%s:%s:%s'', e->>''title'', e->>''works'', right(e->>''oldest_student_id'', 2)), '', '' order by o) from jsonb_array_elements(public.teacher_home()->''mock_pending'') with ordinality x(e, o)'],
   'Пробник №3:3:51, Пробник №4:1:52'),
 ('TA', 'ряды «Просели»: у SA3 8 ДЗ, у SA6 2 пробника; у SA4 7 ДЗ — нет',
   array['select string_agg(format(''%s hw=%s mocks=%s'', e->>''student_name'', jsonb_array_length(e->''hw''), jsonb_array_length(e->''mocks'')), '', '' order by e->>''student_name'') from jsonb_array_elements(public.teacher_home()->''series'') e'],
   'Валиев Карим hw=8 mocks=0, Хасанов Тимур hw=0 mocks=2'),
 ('TA', 'ряд ДЗ по времени сдачи; пятёрка → %, возвращённая попытка без балла не в ряду',
   array['select (e->''hw'')::text from jsonb_array_elements(public.teacher_home()->''series'') e where e->>''student_name'' = ''Валиев Карим'''],
   '[80.00, 82.00, 80.00, 84.00, 79.00, 60.00, 62.00, 70.00]'),
 ('TA', 'ряд пробников по дате; без таблицы перевода — первичные',
   array['select (e->''mocks'')::text from jsonb_array_elements(public.teacher_home()->''series'') e where e->>''student_name'' = ''Хасанов Тимур'''],
   '[{"unit": "primary", "score": 70}, {"unit": "primary", "score": 58}]'),
 ('TA', 'ближайшее на 7 дней: срок сегодня, пробник через 3 дня, срок через 5; через 9 — нет',
   array['select string_agg(format(''%s:%s:%s'', e->>''kind'', e->>''title'', ((e->>''day'')::date - {TODAY}::date)), '', '' order by o) from jsonb_array_elements(public.teacher_home()->''upcoming'') with ordinality x(e, o)'],
   'homework:Срок сегодня:0, mock:Пробник №5:3, homework:Срок через 5 дней:5'),
-- ── «Напомнить всем» ─────────────────────────────────────────────────────
 ('TA', 'напомнить всем: одно сообщение SA1 (2 ДЗ), без Telegram и выключившие — поимённо',
   array[:REM], 'sent=1 pairs=2 already=0 none=Никитина Вера muted=Зиннатуллин Артур'),
 ('TA', 'в очередь — одна строка topic_homework_reminder для SA1 с двумя ДЗ, первое — старший срок',
   array[:REM,
         'SU:select format(''q=%s items=%s first=%s link=%s'', count(*), max(jsonb_array_length(payload->''items'')), max(payload->''items''->0->>''title''), max(payload->>''link'')) from notification_queue where event_type = ''topic_homework_reminder'' and profile_id = ''{PSA1}'''],
   'sent=1 pairs=2 already=0 % ; q=1 items=2 first=Отбор корней link=/my-course/{GA}/topic/{T01}'),
 ('TA', 'повтор сразу — никому не уходит (24 часа), в очереди по-прежнему одна строка',
   array[:REM, :REM,
         'SU:select count(*)::text from notification_queue where event_type = ''topic_homework_reminder'''],
   'sent=1 pairs=2 already=0 % ; sent=0 pairs=0 already=2 % ; 1'),
 ('TA', 'после отправки главная видит «напомнили» у обеих строк SA1',
   array[:REM,
         'select count(*)::text from jsonb_array_elements(public.teacher_home()->''overdue'') e where e->>''reminded_at'' is not null'],
   'sent=1 % ; 2'),
 ('TA', 'через 25 часов — снова можно',
   array[:REM, 'SU:update topic_homework_reminders set sent_at = sent_at - interval ''25 hours''', :REM],
   'sent=1 pairs=2 % ; rows=2 ; sent=1 pairs=2 %'),
 ('TA', 'защита общая на курс: после TA куратор того же курса не будит SA1 повторно',
   array[:REM, 'AS:CUR:' || :REM],
   'sent=1 pairs=2 % ; sent=0 pairs=0 already=2 %'),
 ('TA', 'только SA2 (нет Telegram) — не отправлено, названа',
   array['select format(''sent=%s none=%s'', r->>''sent'', r->''no_telegram''->0->>''name'') from public.remind_overdue_homework(null, array[''{SA2}''::uuid]) r',
         'SU:select count(*)::text from notification_queue where event_type = ''topic_homework_reminder'''],
   'sent=0 none=Никитина Вера ; 0'),
 ('TA', 'чужой ученик в списке — отказ целиком',
   array['select public.remind_overdue_homework(null, array[''{SA1}''::uuid, ''{SB1}''::uuid])::text',
         'SU:select count(*)::text from notification_queue where event_type = ''topic_homework_reminder'''],
   'ERR 42501: % ; 0'),
 ('TB', 'посторонний преподаватель ученику CA — отказ',
   array['select public.remind_overdue_homework(null, array[''{SA1}''::uuid])::text'], 'ERR 42501: %'),
 ('TB', 'посторонний «всем» — только своему должнику SB1 (черновик — не сдача)',
   array[:REM, 'SU:select count(*)::text from notification_queue where event_type = ''topic_homework_reminder'' and profile_id = ''{PSA1}'''],
   'sent=1 pairs=1 already=0 none= muted= ; 0'),
 ('SA1', 'ученик: себе/кому-то по списку — отказ',
   array['select public.remind_overdue_homework(null, array[''{SA1}''::uuid])::text'], 'ERR 42501: %'),
 ('SA1', 'ученик «всем» — никому',
   array[:REM], 'sent=0 pairs=0 already=0 none= muted='),
 ('SA1', 'журнал напоминаний закрыт: чтение и запись',
   array['select count(*)::text from topic_homework_reminders',
         'insert into topic_homework_reminders (homework_id, student_id) values (''33700000-0000-0000-0000-000000000001'', ''{SA1}'') returning id::text'],
   'ERR 42501: % ; ERR 42501: %'),
 ('TA', 'внутренние помощники клиенту недоступны',
   array['select count(*)::text from public.teacher_home_overdue(null)',
         'select count(*)::text from public.teacher_home_scope(null)'],
   'ERR 42501: % ; ERR 42501: %');

-- Подстановка коротких имён.
do $$
declare r record;
begin
  for r in select * from ids order by length(k) desc loop
    update probes set stmts = (select array_agg(replace(s, '{' || r.k || '}',
                                 case when r.k = 'TODAY' then quote_literal(r.v) else r.v end) order by o)
                                 from unnest(stmts) with ordinality u(s, o)),
                      expected = replace(expected, '{' || r.k || '}', r.v);
  end loop;
end $$;

-- Прогон: каждая проба — подтранзакция, откатываемая 'PROBE:%'.
do $$
declare
  p record; s text; v text; res text; v_who text; cnt bigint;
begin
  for p in select * from probes order by n loop
    begin
      v_who := p.who;
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', (select uid from actors a where a.who = p.who), 'role', 'authenticated')::text, true);
      v := null;
      foreach s in array p.stmts loop
        if s like 'SU:%' then
          perform set_config('role', 'postgres', true);
          if substr(s, 4) like 'select%' then
            res := public.probe_val(substr(s, 4));
          else
            execute substr(s, 4);
            get diagnostics cnt = row_count;
            res := 'rows=' || cnt;
          end if;
          perform set_config('role', 'authenticated', true);
        else
          if s like 'AS:%' then
            v_who := split_part(s, ':', 2);
            s := substr(s, length('AS:' || v_who || ':') + 1);
            perform set_config('request.jwt.claims',
              json_build_object('sub', (select uid from actors a where a.who = v_who), 'role', 'authenticated')::text, true);
          end if;
          res := public.probe_val(s);
        end if;
        v := coalesce(v || ' ; ', '') || res;
      end loop;
      raise exception 'PROBE:%', v;
    exception when others then
      if sqlerrm like 'PROBE:%' then v := substr(sqlerrm, 7); else v := 'OUTER ' || sqlstate || ': ' || sqlerrm; end if;
    end;
    update probes set actual = v where probes.n = p.n;
  end loop;
end $$;

\echo '=================== §233: кто × действие → ожидаемо / факт ==================='
select n, who, action, expected, actual, case when actual like expected then 'ok' else 'FAIL' end as verdict
  from probes order by n;

\echo '--- Непрошедшие целиком'
\x on
select n, expected, actual from probes where actual not like expected order by n;
\x off
\echo '--- Итог'
select count(*) as probes, count(*) filter (where actual like expected) as ok,
       count(*) filter (where actual not like expected) as fail
  from probes;

\echo '--- После прогона данные не тронуты (все пробы откатились)'
select (select count(*) from topic_homework_reminders) as reminders,
       (select count(*) from notification_queue where event_type = 'topic_homework_reminder') as queue_reminders;

\echo '--- Права на функции §233'
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon, p.prosecdef as definer
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname in ('teacher_home', 'teacher_home_scope', 'teacher_home_overdue', 'remind_overdue_homework')
 order by 1;
