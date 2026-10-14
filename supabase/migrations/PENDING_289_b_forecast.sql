-- §289 (часть B) — диагностика в прогнозе. МЕНЯЕТ СУЩЕСТВУЮЩЕЕ — владелец в
-- SQL Editor, целиком, ПОСЛЕ части A (PENDING_289_a_diagnostic.sql).
--
-- Две вставки по якорю (ровно одно вхождение, иначе ошибка и откат всего):
--   1. student_exam_evidence_rows: + строки диагностики (diagnostic_evidence_rows
--      из A: source 'catalog', item 'diag:…', балл 1 / 0,5 / 0). Серии, «Решено
--      задач», баллы школы и награды читают catalog_task_attempts — туда
--      диагностика не пишет, они не меняются;
--   2. student_forecast_evidence_of: предметы прогноза = предметы групп ученика
--      + предметы его пройденной диагностики (diagnostic_done_subjects из A) —
--      у ученика «с улицы» до пробного группы нет, а прогноз нужен на экране
--      результата.
--
-- Для всех, у кого нет строк диагностики, результат функций прежний: обе
-- вставки добавляют пустое множество. Сверка — запрос в конце файла.

begin;
set local lock_timeout = '5s';

do $patch$
declare
  d text;
  v_old text;
  v_new text;
begin
  -- 1. evidence: ещё одна ветка union all
  d := pg_get_functiondef('public.student_exam_evidence_rows(uuid, timestamptz)'::regprocedure);
  if strpos(d, 'diagnostic_evidence_rows') > 0 then
    raise notice '§289 B: evidence уже с диагностикой — пропуск';
  else
    v_old := 'union all select * from var_rows';
    if (length(d) - length(replace(d, v_old, ''))) / length(v_old) <> 1 then
      raise exception '§289 B: в student_exam_evidence_rows ожидалось ровно одно «%» — сверить вручную', v_old;
    end if;
    execute replace(d, v_old,
      v_old || E'\n  union all select * from public.diagnostic_evidence_rows(p_profile_id, p_from)');
  end if;

  -- 2. предметы прогноза: + пройденная диагностика
  d := pg_get_functiondef('public.student_forecast_evidence_of(uuid, timestamptz)'::regprocedure);
  if strpos(d, 'diagnostic_done_subjects') > 0 then
    raise notice '§289 B: forecast_evidence_of уже с диагностикой — пропуск';
  else
    if d !~ 'and c\.subject::text in \(''math'', ''physics''\)(\s+)\),(\s+)ev as \(' then
      raise exception '§289 B: в student_forecast_evidence_of не найден конец my_subjects — сверить вручную';
    end if;
    if (select count(*) from regexp_matches(d, 'ev as \(', 'g')) <> 1 then
      raise exception '§289 B: «ev as (» в student_forecast_evidence_of не одно — сверить вручную';
    end if;
    execute regexp_replace(d,
      'and c\.subject::text in \(''math'', ''physics''\)(\s+)\),(\s+)ev as \(',
      'and c.subject::text in (''math'', ''physics'')'
      || E'\n    union\n    select d.subject from public.diagnostic_done_subjects(p_profile_id) d'
      || '\1),\2ev as (');
  end if;
end $patch$;

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Сверка (отдельным запуском, ДО и ПОСЛЕ — md5 должны совпасть, пока строк
-- диагностики на проде нет): evidence всех учеников за 180 дней.
-- ─────────────────────────────────────────────────────────────────────────
-- select md5(string_agg(x::text, '|' order by x::text))
--   from public.profiles p,
--        lateral public.student_exam_evidence_rows(p.id, now() - interval '180 days') x
--  where p.role = 'student';
