-- §223. Уведомление о результате пробника: статистика и срок доставки.
--
-- Та же функция notify_mock_exam_results (§219), три добавки:
--   1. «Лучше, чем N % группы» — доля тех, у кого итог ниже, среди других
--      учеников группы с итогом по этому пробнику. Только если других не
--      меньше трёх; ноль не пишется; при высшем итоге — «лучший результат».
--   2. Разница с прошлым пробником того же шаблона (та же шкала).
--   3. Онлайн-пробник: Telegram не раньше конца окна (scheduled_for),
--      как и экран результата (§221).
-- Сигнатура и права не меняются.

create or replace function public.notify_mock_exam_results(
  p_mock_exam_id uuid,
  p_student_ids  uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam        record;
  v_now         timestamptz := now();
  v_part1_max   int;
  v_part2_max   int;
  v_primary_max int;
  v_r           record;
  v_key         text;
  v_msg         text;
  v_sent        int := 0;
  v_telegram    int := 0;
  v_already     int := 0;
  v_no_profile  int := 0;
  v_no_result   int := 0;
  v_n           int;
  v_rows        jsonb := '[]'::jsonb;
  v_ends_at     timestamptz;
  v_peers       int;
  v_lower       int;
  v_higher      int;
  v_better_pct  int;
  v_prev_score  int;
  v_prev_title  text;
  v_stats       text;
begin
  select me.id, me.title, me.date, me.starts_at, me.max_score, me.group_id, me.template_id, g.course_id,
         t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.groups g on g.id = me.group_id
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'Пробник не найден' using errcode = 'P0002';
  end if;
  if v_exam.group_id is null then
    raise exception 'У пробника нет группы — уведомлять некого' using errcode = '22023';
  end if;
  if not (public.course_is_staff(v_exam.course_id)
          and (public.is_admin_or_owner() or public.get_my_role() = 'teacher')) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  if v_exam.max_points is not null then
    select coalesce(sum(m) filter (where i <= v_exam.part1_last), 0)::int,
           coalesce(sum(m) filter (where i >  v_exam.part1_last), 0)::int,
           coalesce(sum(m), 0)::int
      into v_part1_max, v_part2_max, v_primary_max
      from unnest(v_exam.max_points) with ordinality as x(m, i);
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  perform pg_advisory_xact_lock(hashtextextended('notify_mock_exam_results:' || p_mock_exam_id::text, 0));
  if p_student_ids is not null then
    select count(*) into v_no_result
      from (select distinct unnest(p_student_ids) as sid) q
     where not exists (
       select 1 from public.mock_exam_results r
         join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = r.student_id
        where r.mock_exam_id = p_mock_exam_id and r.student_id = q.sid);
  end if;
  for v_r in
    select r.id, r.student_id, r.score, r.part1_score, r.part2_score, r.primary_score,
           r.notified_at, r.notified_score, r.notified_part1_score, r.notified_part2_score,
           s.profile_id
      from public.mock_exam_results r
      join public.students s on s.id = r.student_id
      join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = r.student_id
     where r.mock_exam_id = p_mock_exam_id
       and (p_student_ids is null or r.student_id = any (p_student_ids))
     order by r.student_id
       for update of r
  loop
    if v_r.notified_at is not null
       and (v_r.notified_score, v_r.notified_part1_score, v_r.notified_part2_score)
           is not distinct from (v_r.score, v_r.part1_score, v_r.part2_score) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_r.profile_id is null then
      v_no_profile := v_no_profile + 1;
      continue;
    end if;
    v_key := 'mock_exam_result:' || v_r.id || ':' || floor(extract(epoch from v_now) * 1000)::bigint;
    select count(*)::int,
           count(*) filter (where r2.score < v_r.score)::int,
           count(*) filter (where r2.score > v_r.score)::int
      into v_peers, v_lower, v_higher
      from public.mock_exam_results r2
      join public.group_students gs2 on gs2.group_id = v_exam.group_id and gs2.student_id = r2.student_id
     where r2.mock_exam_id = p_mock_exam_id
       and r2.student_id <> v_r.student_id
       and r2.score is not null;
    v_better_pct := case when v_r.score is not null and v_peers >= 3
                         then floor(100.0 * v_lower / v_peers)::int end;
    v_prev_score := null;
    v_prev_title := null;
    if v_exam.template_id is not null and v_r.score is not null then
      select r3.score, me3.title
        into v_prev_score, v_prev_title
        from public.mock_exam_results r3
        join public.mock_exams me3 on me3.id = r3.mock_exam_id
       where r3.student_id = v_r.student_id
         and me3.id <> p_mock_exam_id
         and me3.template_id = v_exam.template_id
         and r3.score is not null
         and coalesce(me3.starts_at, me3.date) < coalesce(v_exam.starts_at, v_exam.date)
       order by coalesce(me3.starts_at, me3.date) desc
       limit 1;
    end if;
    v_stats := case when v_r.score is not null and v_peers >= 3 and v_higher = 0 then ' · лучший результат в группе'
                    when v_better_pct > 0 then ' · лучше, чем ' || v_better_pct || '% группы'
                    else '' end
            || case when v_prev_score is not null then
                 ' · ' || case when v_r.score - v_prev_score > 0 then '+' when v_r.score - v_prev_score < 0 then '−' else '±' end
                 || abs(v_r.score - v_prev_score) || ' к прошлому пробнику'
               else '' end;
    v_msg := '«' || v_exam.title || '» — ' || v_r.score
      || coalesce(' из ' || v_exam.max_score, '')
      || case when v_r.part1_score is not null or v_r.part2_score is not null then
           ' · 1 часть: ' || coalesce(v_r.part1_score::text, '—') || coalesce(' из ' || v_part1_max, '')
           || ', 2 часть: ' || coalesce(v_r.part2_score::text, '—') || coalesce(' из ' || v_part2_max, '')
         else '' end
      || case when v_r.primary_score is not null and v_r.primary_score is distinct from v_r.score then
           ' · первичный: ' || v_r.primary_score || coalesce(' из ' || v_primary_max, '')
         else '' end
      || v_stats;
    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    values (v_r.profile_id, '📊 Результат пробника', v_msg, 'info', null, v_key)
    on conflict (dedup_key) do nothing;
    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select v_r.profile_id,
           'telegram',
           'mock_exam_result',
           'mock_exam_result',
           v_r.id,
           v_key,
           jsonb_build_object(
             'title',         v_exam.title,
             'exam_date',     to_char(v_exam.date at time zone 'UTC', 'YYYY-MM-DD'),
             'score',         v_r.score,
             'max_score',     v_exam.max_score,
             'primary_score', v_r.primary_score,
             'primary_max',   v_primary_max,
             'part1_score',   v_r.part1_score,
             'part1_max',     v_part1_max,
             'part2_score',   v_r.part2_score,
             'part2_max',     v_part2_max,
             'peers',         v_peers,
             'better_pct',    v_better_pct,
             'is_best',       (v_r.score is not null and v_peers >= 3 and v_higher = 0),
             'prev_score',    v_prev_score,
             'prev_title',    v_prev_title
           ),
           'pending'::public.notification_queue_status,
           greatest(v_now, coalesce(v_ends_at, v_now))
      from public.telegram_connections tc
     where tc.profile_id = v_r.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
    on conflict (deduplication_key) do nothing;
    get diagnostics v_n = row_count;
    v_telegram := v_telegram + v_n;
    update public.mock_exam_results
       set notified_at          = v_now,
           notified_score       = v_r.score,
           notified_part1_score = v_r.part1_score,
           notified_part2_score = v_r.part2_score
     where id = v_r.id;
    v_sent := v_sent + 1;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_r.student_id, 'notified_at', v_now));
  end loop;
  return jsonb_build_object(
    'sent',       v_sent,
    'telegram',   v_telegram,
    'already',    v_already,
    'no_result',  v_no_result,
    'no_profile', v_no_profile,
    'rows',       v_rows
  );
end;
$$;

comment on function public.notify_mock_exam_results(uuid, uuid[]) is
  '§219, §223. Отправить ученикам результат пробника: колокольчик + Telegram (event mock_exam_result), если подключён. null — всем, кому этот итог ещё не отправлен. Помнит отправленный итог в mock_exam_results.notified_*. Персонал курса группы + право записи итогов. §223: в payload — доля группы ниже ученика (от 3 других), прошлый пробник того же шаблона; Telegram онлайн-пробника — не раньше конца окна.';

alter function public.notify_mock_exam_results(uuid, uuid[]) owner to postgres;
revoke all on function public.notify_mock_exam_results(uuid, uuid[]) from public, anon;
grant execute on function public.notify_mock_exam_results(uuid, uuid[]) to authenticated;

