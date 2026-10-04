-- Применено оркестратором 04.10 (MCP apply_migration, версия 20261004113823; без comment on). Баллы школы 45 учеников: 5494 → 5516.
-- §265, баллы школы за ДЗ по 100-балльной шкале (решение владельца 04.10):
--   90–100 баллов — как «5» (10 баллов школы и «пятёрка» для наград), 75–89 — как «4» (6 баллов), ниже 75 — 0.
--   5-балльные — как было. Принятое без балла — как было (баллы за «принято»).
-- Одно правило — функция hw_grade_equiv; две функции, где оно применяется, правятся точечной заменой условий в их
-- текущем теле (student_school_points_of — 20261003114440, student_achievement_progress — 20261002194006):
-- остальной текст функций не меняется. Каждая замена обязана сработать ровно там, где ожидается, иначе — ошибка.

create or replace function public.hw_grade_equiv(p_scale text, p_score integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score is null then null
    when p_scale = 'five' then p_score
    when p_scale = 'hundred' then case when p_score >= 90 then 5 when p_score >= 75 then 4 else 3 end
    else null
  end;
$$;

comment on function public.hw_grade_equiv(text, integer) is
  '§265. Оценка ДЗ в пятибалльном смысле для баллов школы и наград: five — как есть; hundred — 90+ → 5, 75–89 → 4, ниже → 3.';

grant execute on function public.hw_grade_equiv(text, integer) to authenticated;

do $mig$
declare
  d   text;
  n0  text;
begin
  d := pg_get_functiondef('public.student_school_points_of(uuid)'::regprocedure);
  n0 := d;
  d := regexp_replace(d, $re$la\.grade_scale\s*=\s*'five'\s+and\s+la\.score\s*=\s*5$re$,
                      'public.hw_grade_equiv(la.grade_scale, la.score) = 5', 'g');
  d := regexp_replace(d, $re$la\.grade_scale\s*=\s*'five'\s+and\s+la\.score\s*=\s*4$re$,
                      'public.hw_grade_equiv(la.grade_scale, la.score) = 4', 'g');
  d := regexp_replace(d, $re$la\.grade_scale\s*=\s*'five'\s+and\s+la\.score\s+is\s+not\s+null\s+then\s+0$re$,
                      'public.hw_grade_equiv(la.grade_scale, la.score) is not null then 0', 'g');
  if d = n0 then
    if position('hw_grade_equiv' in d) > 0 then
      null;
    else
      raise exception '§265: в student_school_points_of не найдено правило hw_grade';
    end if;
  elsif (length(d) - length(replace(d, 'public.hw_grade_equiv(', ''))) / length('public.hw_grade_equiv(') <> 3 then
    raise exception '§265: student_school_points_of — ожидалось ровно 3 замены';
  end if;
  execute d;

  d := pg_get_functiondef('public.student_achievement_progress(uuid)'::regprocedure);
  n0 := d;
  d := regexp_replace(d, $re$l\.grade_scale\s*=\s*'five'\s+and\s+l\.score\s*=\s*5$re$,
                      'public.hw_grade_equiv(l.grade_scale, l.score) = 5', 'g');
  if d = n0 then
    if position('hw_grade_equiv' in d) = 0 then
      raise exception '§265: в student_achievement_progress не найдено условие «пятёрки»';
    end if;
  elsif (length(d) - length(replace(d, 'public.hw_grade_equiv(', ''))) / length('public.hw_grade_equiv(') <> 1 then
    raise exception '§265: student_achievement_progress — ожидалась ровно 1 замена';
  end if;
  execute d;
end
$mig$;
