-- Преподаватель узнаёт, что к нему записался ученик.
--
-- Раньше `notify_course_enrolled` слал только ученику («Вы добавлены в курс»),
-- а преподаватель не узнавал ничего. Второе оповещение живёт в этой же
-- функции: второй триггер на ту же таблицу — это второй механизм, который
-- разъедется с первым (урок §49, где событие сдачи расползлось на два имени).
--
-- Две ветки теперь независимы: раньше зачисление преподавателя/владельца в
-- собственный курс выходило из функции целиком через ранний `return`. Теперь у
-- каждой ветки свои условия — ученическая молчит про самого себя, персональная
-- про себя же, но одна не гасит другую.
--
-- Приватность: имя и почта уходят только персоналу этого курса. В Telegram
-- почта не уезжает вовсе — канал вне нашего контроля, там хватает имени.

create or replace function public.notify_course_enrolled()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v             record;
  v_actor       uuid := auth.uid();
  v_staff       uuid;
  v_student_app text;   -- для карточки в приложении: имя, иначе почта
  v_student_tg  text;   -- для Telegram: имя, но никогда не почта
  v_group_extra text;   -- название группы, если оно отличается от курса
begin
  -- Всё, что ниже, — только оповещение. Его сбой не должен отменить саму
  -- привязку ученика к курсу: причина уходит в notification_dispatch_errors,
  -- пустых exception-блоков здесь нет (§47).
  begin
    select s.profile_id            as student_profile,
           sp.full_name            as student_name,
           sp.email                as student_email,
           g.id                    as group_id,
           g.name                  as group_name,
           c.title                 as course_title,
           c.owner_id              as course_owner,
           t.profile_id            as teacher_profile,
           tp.full_name            as teacher_name
      into v
      from public.groups g
      left join public.courses  c  on c.id  = g.course_id
      left join public.teachers t  on t.id  = g.teacher_id
      left join public.profiles tp on tp.id = t.profile_id
      join public.students s on s.id = new.student_id
      left join public.profiles sp on sp.id = s.profile_id
     where g.id = new.group_id;

    if not found or v.student_profile is null then
      return new;
    end if;

    -- Название группы показываем только если оно не повторяет курс: у «курс =
    -- одна группа» они совпадают, и «11А · 11А» читать незачем.
    v_group_extra := case
      when v.group_name is null or v.course_title is null then null
      when btrim(v.group_name) = btrim(v.course_title)    then null
      else v.group_name
    end;

    -- ── 1. Ученику: «Вы добавлены в курс» ──────────────────────────────────
    -- Преподавателю и владельцу курса карточку о самом себе не слать: в этой
    -- школе один человек часто и владелец, и преподаватель.
    if v.student_profile is distinct from v.teacher_profile
       and v.student_profile is distinct from v.course_owner then

      insert into public.notifications (user_id, title, message, type, link, dedup_key)
      values (
        v.student_profile,
        'Вы добавлены в курс',
        coalesce(v.course_title, v.group_name, 'Курс')
          || coalesce('. Преподаватель: ' || v.teacher_name, ''),
        'success',
        '/my-course/' || v.group_id,
        'course_enrolled:' || v.group_id || ':' || new.student_id
      )
      on conflict (dedup_key) do nothing;

      -- Производитель кладёт данные, текст собирает воркер (§65, §69).
      -- Строка появляется только при живой связке Telegram — так же, как у
      -- остальных событий; ждущих привязки строк в очереди не копим.
      insert into public.notification_queue
        (profile_id, channel, event_type, entity_type, entity_id,
         deduplication_key, payload, status, scheduled_for)
      select v.student_profile,
             'telegram',
             'course_enrolled',
             'group',
             v.group_id,
             'course_enrolled:' || v.group_id || ':' || new.student_id,
             jsonb_build_object(
               'course_title',  coalesce(v.course_title, v.group_name),
               'teacher_name',  v.teacher_name,
               'link',          '/my-course/' || v.group_id,
               'button_text',   'Открыть курс'
             ),
             'pending'::notification_queue_status,
             now()
        from public.telegram_connections tc
       where tc.profile_id = v.student_profile
         and tc.is_enabled
         and tc.disconnected_at is null
         and tc.telegram_chat_id is not null
      on conflict (deduplication_key) do nothing;
    end if;

    -- ── 2. Персоналу: «Новый ученик в курсе» ───────────────────────────────
    --
    -- Получатель: преподаватель группы, а если его нет — владелец курса. Это
    -- одно значение, поэтому «один и тот же человек» не может получить два
    -- письма по построению.
    v_staff := coalesce(v.teacher_profile, v.course_owner);

    -- Кто зачислил, тот и так знает. Но:
    --   • вступление по ссылке — auth.uid() это УЧЕНИК, персоналу слать надо;
    --   • зачисление скриптом под сервисным ключом — auth.uid() пуст, слать
    --     тоже надо, иначе о массовой заливке никто не узнает.
    -- Поэтому молчим ровно в одном случае: получатель и есть действующий.
    if v_staff is not null
       and v_staff is distinct from v.student_profile
       and (v_actor is null or v_staff is distinct from v_actor) then

      -- Имя пустое — не выдумываем «Ученик»: показываем почту, а если и её
      -- нет, честно говорим, что имя не заполнено. Молчаливая подстановка
      -- превратила бы «профиль без имени» в «обычного ученика».
      v_student_tg  := nullif(btrim(coalesce(v.student_name, '')), '');
      v_student_app := coalesce(
        v_student_tg,
        nullif(btrim(coalesce(v.student_email, '')), ''),
        'имя не заполнено'
      );
      v_student_tg  := coalesce(v_student_tg, 'имя не заполнено');

      insert into public.notifications (user_id, title, message, type, link, dedup_key)
      values (
        v_staff,
        'Новый ученик в курсе',
        v_student_app
          || ' — ' || coalesce(v.course_title, v.group_name, 'курс')
          || coalesce(' · ' || v_group_extra, ''),
        'info',
        '/students/' || new.student_id,
        'course_enrolled_staff:' || v.group_id || ':' || new.student_id
      )
      on conflict (dedup_key) do nothing;

      -- Свой ключ дедупликации: с ученическим они не должны гасить друг друга.
      -- Почты в payload нет — см. шапку про приватность.
      insert into public.notification_queue
        (profile_id, channel, event_type, entity_type, entity_id,
         deduplication_key, payload, status, scheduled_for)
      select v_staff,
             'telegram',
             'course_student_enrolled',
             'group',
             v.group_id,
             'course_enrolled_staff:' || v.group_id || ':' || new.student_id,
             jsonb_build_object(
               'student_name', v_student_tg,
               'course_title', coalesce(v.course_title, v.group_name),
               'group_name',   v_group_extra,
               'link',         '/students/' || new.student_id,
               'button_text',  'Открыть ученика'
             ),
             'pending'::notification_queue_status,
             now()
        from public.telegram_connections tc
       where tc.profile_id = v_staff
         and tc.is_enabled
         and tc.disconnected_at is null
         and tc.telegram_chat_id is not null
      on conflict (deduplication_key) do nothing;
    end if;
  exception when others then
    perform public.notification_log_dispatch_error(
      'notify_course_enrolled', new.group_id, sqlstate, sqlerrm);
  end;

  return new;
end $function$;

comment on function public.notify_course_enrolled() is
  'Зачисление в группу курса: карточка ученику («Вы добавлены в курс») и карточка персоналу («Новый ученик в курсе»). Две независимые ветки со своими дедуп-ключами в одной триггерной функции — второй триггер на ту же таблицу разъехался бы с первым. Персоналу — преподаватель группы, иначе владелец курса; тому, кто сам зачислил, не шлём. Почта ученика уходит только в карточку приложения, в Telegram — никогда.';
