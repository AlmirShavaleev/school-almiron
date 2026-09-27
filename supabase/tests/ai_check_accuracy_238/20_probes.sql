-- §238. Пробы ai_check_accuracy: права и счёт.
-- Каждая проба: claims — отдельным set_config (CLAUDE.md §29.4), роль authenticated
-- (или anon) — set local role, затем вызов; ошибка ловится и печатается кодом.
-- Всё в одной транзакции с откатом в конце: пробы только читают, но так надёжнее.
\pset footer off
begin;
create function pg_temp.probe(p_uid text, p_role text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{}' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ОТКАЗ ' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  return coalesce(v, '(пусто)');
end $$;

create temp table probes (n serial, who text, action text, expected text, actual text);
\set R '''select string_agg(format(''''%s/%s: %s зад., %s изм., %s раб.'''', ai_verdict, case when answer_match then ''''совпал'''' else ''''нет'''' end, tasks, changed, works), ''''; '''') from public.ai_check_accuracy()'''
\set R30 '''select string_agg(format(''''%s/%s: %s зад., %s изм., %s раб.'''', ai_verdict, case when answer_match then ''''совпал'''' else ''''нет'''' end, tasks, changed, works), ''''; '''') from public.ai_check_accuracy(now() - interval ''''30 days'''')'''

insert into probes (who, action, expected, actual) values
 ('админ', 'отчёт за 7 дней (по умолчанию)',
  'correct/совпал: 4 зад., 1 изм., 2 раб.; correct/нет: 1 зад., 0 изм., 1 раб.; partial/совпал: 2 зад., 1 изм., 2 раб.; partial/нет: 1 зад., 0 изм., 1 раб.; wrong/совпал: 1 зад., 1 изм., 1 раб.; unchecked/нет: 1 зад., 1 изм., 1 раб.',
  pg_temp.probe('38000000-0000-0000-0000-00000000000a', 'authenticated', :R)),
 ('владелец', 'отчёт за 7 дней',
  'то же, что у админа',
  pg_temp.probe('38000000-0000-0000-0000-00000000000b', 'authenticated', :R)),
 ('админ', 'отчёт за 30 дней: давний вердикт at3 добавляет correct/совпал 1 изм.',
  'correct/совпал: 5 зад., 2 изм., 3 раб.; …',
  pg_temp.probe('38000000-0000-0000-0000-00000000000a', 'authenticated', :R30)),
 ('преподаватель без admin', 'отчёт за 7 дней',
  'ОТКАЗ 42501',
  pg_temp.probe('38000000-0000-0000-0000-0000000000a1', 'authenticated', :R)),
 ('ученик', 'отчёт за 7 дней',
  'ОТКАЗ 42501',
  pg_temp.probe('38000000-0000-0000-0000-000000000051', 'authenticated', :R)),
 ('authenticated без sub', 'отчёт за 7 дней',
  'ОТКАЗ 42501',
  pg_temp.probe(null, 'authenticated', :R)),
 ('anon', 'вызов функции',
  'ОТКАЗ 42501: permission denied for function',
  pg_temp.probe(null, 'anon', :R)),
 ('ученик', 'нормализация ответа (помощник открыт authenticated, данных не читает)',
  '0.2 | -8 | 12м/с | в144раза',
  pg_temp.probe('38000000-0000-0000-0000-000000000051', 'authenticated',
    $q$select concat_ws(' | ', public.ai_check_normalize_answer('0,20'), public.ai_check_normalize_answer('−8.'), public.ai_check_normalize_answer(' 12 М/С '), public.ai_check_normalize_answer('в 144 раза'))$q$));

select n, who, action, expected, actual from probes order by n;
rollback;
