-- «Тема пройдена» — одно определение на всю платформу, теперь и в базе.
--
-- ЗАЧЕМ ФУНКЦИЯ, А НЕ ЗАПРОС НА МЕСТЕ. Карточка на вкладке «Сейчас» (§152) и
-- учебный план (§151) считают одно и то же «пройдено». Посчитай они по-разному
-- — владелец получит два несходящихся числа и перестанет верить обоим. Поэтому
-- определение живёт здесь, а оба чата его переиспользуют.
--
-- ОПРЕДЕЛЕНИЕ СТРОГОЕ, повторяет `topicDone` из `src/lib/topicProgress.ts`, а
-- не пересказывает его:
--
--   • у темы есть ГРУППЫ, и считаются только те, что реально наполнены:
--       theory   — видео, конспекты, теория;
--       lesson   — задачи, разборы задач, рабочий лист задач;
--       homework — ДЗ темы, рабочий лист ДЗ, решение ДЗ;
--   • «Тестирование» ни в одну группу не входит (§121) и на завершённость не
--     влияет;
--   • theory и lesson закрывает САМООТМЕТКА ученика (§122: отметка стоит на
--     группе, а не на рубрике);
--   • homework закрывает ПРИНЯТАЯ работа, а не отметка — её в таблице отметок
--     не бывает никогда;
--   • тема без единой группы пройденной не считается: «пройдено» там означало
--     бы «преподаватель ещё ничего не выложил».
--
-- Мягкое определение («есть хоть одна отметка по теме») давало бы 33 пары
-- вместо 10 на тех же данных — почти втрое больше того, что обещает подпись
-- «тема пройдена».
--
-- ПРАВА: функция намеренно НЕ security definer. Она работает под правами
-- вызывающего, и RLS сама решает, чьи отметки он видит: ученик — свои,
-- персонал — своих курсов, админ — все. Так её можно переиспользовать откуда
-- угодно, не заводя вторую проверку прав и не рискуя утечкой.
create or replace function public.topic_done_events()
returns table (
  student_id uuid,
  topic_id   uuid,
  done_at    timestamptz
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with tg as (
    select t.id as topic_id,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and (mi.kind = 'video' or mi.section in ('notes', 'theory'))
      ) as has_theory,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and mi.section in ('tasks', 'task_solution', 'worksheet_tasks')
      ) as has_lesson,
      (
        exists (select 1 from public.topic_homework h where h.topic_id = t.id)
        or exists (
          select 1 from public.topic_material_items mi
           where mi.topic_id = t.id
             and mi.section in ('worksheet_homework', 'solution')
        )
      ) as has_homework
    from public.topics t
  ),
  -- Кандидаты — те, кто хоть что-то сделал по теме. Принятой работой тоже:
  -- тема, у которой есть только группа ДЗ, отметок не имеет вовсе, и по одним
  -- отметкам такая пара потерялась бы.
  cand as (
    select m.student_id, m.topic_id from public.topic_section_marks m
    union
    select a.student_id, h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.status = 'accepted'
  ),
  ev as (
    select c.student_id, c.topic_id,
           tg.has_theory, tg.has_lesson, tg.has_homework,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'theory') as theory_at,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'lesson') as lesson_at,
           (select max(r.created_at) from public.topic_homework_reviews r
              join public.topic_homework_attempts a on a.id = r.attempt_id
              join public.topic_homework h on h.id = a.homework_id
             where a.student_id = c.student_id and h.topic_id = c.topic_id
               and a.status = 'accepted' and r.decision = 'accepted') as hw_at
      from cand c
      join tg on tg.topic_id = c.topic_id
  )
  select ev.student_id, ev.topic_id,
         -- День, когда тема стала пройденной, — момент ПОСЛЕДНЕГО из нужных
         -- событий. Ненужные группы обнуляются явно: случайная отметка по
         -- группе, которой у темы нет, не должна двигать дату вперёд.
         greatest(
           case when ev.has_theory   then ev.theory_at end,
           case when ev.has_lesson   then ev.lesson_at end,
           case when ev.has_homework then ev.hw_at     end
         ) as done_at
    from ev
   where (ev.has_theory or ev.has_lesson or ev.has_homework)
     and (not ev.has_theory   or ev.theory_at is not null)
     and (not ev.has_lesson   or ev.lesson_at is not null)
     and (not ev.has_homework or ev.hw_at     is not null);
$$;

revoke all on function public.topic_done_events() from public, anon;
grant execute on function public.topic_done_events() to authenticated;

comment on function public.topic_done_events() is
  'Пары (ученик, тема), где тема ПРОЙДЕНА строго, и момент, когда это '
  'случилось. Повторяет topicDone из src/lib/topicProgress.ts: группы theory и '
  'lesson закрываются самоотметкой, homework — принятой работой, тема без '
  'групп не считается. Работает под правами вызывающего — RLS решает, чьи '
  'данные он видит. Одно определение на §151 и §152: два разных «пройдено» '
  'обесценили бы оба.';

-- ── Два новых ряда для карточек §152 ───────────────────────────────────────
--
-- Правка ДОБАВЛЯЮЩАЯ: к восьми прежним ключам прибавляются `queue_daily` и
-- `marks_daily`. Старые не трогаются и не переименовываются — экран, который
-- новых не знает, продолжает работать.
--
-- Оба ряда идут отсюда, а не отдельными запросами с экрана: иначе открытие
-- вкладки стало бы пятью запросами вместо трёх.
create or replace function public.admin_live_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_result jsonb;
begin
  if not public.is_admin_or_owner() then
    raise exception 'ONLY_ADMIN_SEES_SCHOOL_STATS' using errcode = 'P0001';
  end if;

  select jsonb_build_object(

    'visits_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'people', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(distinct v.profile_id) from public.app_visits v where v.visited_on = d::date) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    'submits_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'count', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(*) from public.topic_homework_attempts a
                 where a.submitted_at is not null
                   and (a.submitted_at at time zone 'Europe/Moscow')::date = d::date) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    -- Очередь проверки по дням — величина УРОВНЯ, а не потока: сколько работ
    -- ждало разбора на конец каждого дня.
    --
    -- Выводится из живых отметок времени, а не восстанавливается на глаз:
    -- сдано не позже конца дня И разбора на конец того же дня ещё не было.
    -- Проверка вывода: последнее значение ряда обязано совпасть с
    -- `admin_school_stats().homework_pending` — это одна и та же величина,
    -- посчитанная двумя разными способами.
    'queue_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'count', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(*) from public.topic_homework_attempts a
                 where a.submitted_at is not null
                   and (a.submitted_at at time zone 'Europe/Moscow')::date <= d::date
                   and not exists (
                     select 1 from public.topic_homework_reviews r
                      where r.attempt_id = a.id
                        and (r.created_at at time zone 'Europe/Moscow')::date <= d::date
                   )) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    -- «Тема пройдена» по дням — СТРОГО, через topic_done_events().
    -- Счёт по отметкам рубрик дал бы 61 событие вместо 10 на тех же данных,
    -- то есть число не сходилось бы с собственной подписью.
    'marks_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'count', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(*) from public.topic_done_events() e
                 where e.done_at is not null
                   and (e.done_at at time zone 'Europe/Moscow')::date = d::date) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    'week', jsonb_build_object(
      'visits_this', (select count(*) from public.app_visits where visited_on > v_today - 7),
      'visits_prev', (select count(*) from public.app_visits
                       where visited_on > v_today - 14 and visited_on <= v_today - 7),
      'submits_this', (select count(*) from public.topic_homework_attempts
                        where submitted_at is not null
                          and (submitted_at at time zone 'Europe/Moscow')::date > v_today - 7),
      'submits_prev', (select count(*) from public.topic_homework_attempts
                        where submitted_at is not null
                          and (submitted_at at time zone 'Europe/Moscow')::date > v_today - 14
                          and (submitted_at at time zone 'Europe/Moscow')::date <= v_today - 7)
    ),

    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'events', c) order by h), '[]'::jsonb)
      from (
        select h,
               (select count(*) from (
                  select a.submitted_at as at from public.topic_homework_attempts a
                   where a.submitted_at is not null and a.submitted_at > now() - interval '30 days'
                  union all
                  select r.created_at from public.topic_homework_reviews r
                   where r.created_at > now() - interval '30 days'
                  union all
                  select m.marked_at from public.topic_section_marks m
                   where m.marked_at > now() - interval '30 days'
                ) e
                where extract(hour from (e.at at time zone 'Europe/Moscow')) = h) as c
        from generate_series(0, 23) h
      ) s
    ),

    'reach', jsonb_build_object(
      'active_7d', (
        select count(distinct s.id)
          from public.students s
          join public.app_visits v on v.profile_id = s.profile_id
         where v.visited_on > v_today - 7
           and exists (select 1 from public.group_students gs where gs.student_id = s.id)
      ),
      'enrolled', (
        select count(distinct gs.student_id) from public.group_students gs
      )
    ),

    'visit_days_per_student', (
      select case when count(distinct s.id) = 0 then 0
                  else round(count(*)::numeric / count(distinct s.id), 1) end
        from public.students s
        join public.app_visits v on v.profile_id = s.profile_id
       where v.visited_on > v_today - 7
    ),

    'new_students', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id', s.id, 'profile_id', p.id,
               'full_name', p.full_name, 'created_at', s.created_at
             ) order by s.created_at desc), '[]'::jsonb)
        from public.students s
        join public.profiles p on p.id = s.profile_id
       where s.created_at > now() - interval '7 days'
    ),

    'no_telegram', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id', s.id, 'profile_id', p.id, 'full_name', p.full_name
             ) order by p.full_name), '[]'::jsonb)
        from public.students s
        join public.profiles p on p.id = s.profile_id
       where s.is_active
         and not exists (
           select 1 from public.telegram_connections tc
            where tc.profile_id = s.profile_id
              and tc.disconnected_at is null
              and coalesce(tc.is_enabled, true)
         )
    )

  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_live_pulse() from public, anon;
grant execute on function public.admin_live_pulse() to authenticated;
