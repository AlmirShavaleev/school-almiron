-- Обращение «Сообщить о проблеме»: тема и скриншоты.
--
-- Владелец посмотрел первую версию и попросил: кнопка плавающая в правом
-- нижнем углу на любой странице, в форме — тема, текст и вложения-скриншоты.
--
-- Хранилище вложений устроено как у остальных приватных бакетов проекта:
-- первая папка пути — `auth.uid()`, запись только в свою папку, чтение себе и
-- админам. Ничего нового не изобретаем.

-- 1. Тема и вложения в обращении -----------------------------------------

alter table public.support_requests
  add column if not exists subject     text,
  add column if not exists attachments text[] not null default '{}';

alter table public.support_requests
  drop constraint if exists support_requests_subject_len;
alter table public.support_requests
  add constraint support_requests_subject_len
  check (subject is null or char_length(subject) between 3 and 120);

alter table public.support_requests
  drop constraint if exists support_requests_attachments_max;
alter table public.support_requests
  add constraint support_requests_attachments_max
  check (coalesce(array_length(attachments, 1), 0) <= 5);

comment on column public.support_requests.attachments is
  'Пути объектов в бакете support-attachments. Проверяются при приёме: путь обязан лежать в папке автора и существовать. Ссылки не хранятся — они подписываются на момент отправки.';

-- 2. Бакет для скриншотов -------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists support_attachments_insert_own on storage.objects;
create policy support_attachments_insert_own on storage.objects
  for insert with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists support_attachments_select_own_or_admin on storage.objects;
create policy support_attachments_select_own_or_admin on storage.objects
  for select using (
    bucket_id = 'support-attachments'
    and ((storage.foldername(name))[1] = (auth.uid())::text or public.is_admin_or_owner())
  );

drop policy if exists support_attachments_delete_own on storage.objects;
create policy support_attachments_delete_own on storage.objects
  for delete using (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

-- 3. Приём обращения: тема + вложения -------------------------------------
--
-- Старая двухаргументная версия снимается: интерфейс с ней ещё не выкатывался,
-- живых вызовов нет. Оставлять перегрузку с умолчаниями нельзя — вызов с двумя
-- аргументами стал бы неоднозначным.

drop function if exists public.submit_support_request(text, text);

create or replace function public.submit_support_request(
  p_subject     text,
  p_message     text,
  p_page_path   text default null,
  p_attachments text[] default '{}'
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_author uuid := auth.uid();
  v_role   public.user_role;
  v_name   text;
  v_subj   text := nullif(btrim(coalesce(p_subject, '')), '');
  v_msg    text := btrim(coalesce(p_message, ''));
  v_page   text := nullif(left(btrim(coalesce(p_page_path, '')), 300), '');
  v_files  text[] := coalesce(p_attachments, '{}');
  v_file   text;
  v_id     uuid;
  v_role_label text;
begin
  if v_author is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_subj is null or char_length(v_subj) < 3 then
    raise exception 'SUBJECT_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(v_subj) > 120 then
    raise exception 'SUBJECT_TOO_LONG' using errcode = 'P0001';
  end if;

  -- Длина: снизу — чтобы «ааа» не считалось обращением, сверху — чтобы
  -- карточка в Telegram не упёрлась в лимит сообщения.
  if char_length(v_msg) < 10 then
    raise exception 'MESSAGE_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(v_msg) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001';
  end if;

  if coalesce(array_length(v_files, 1), 0) > 5 then
    raise exception 'TOO_MANY_ATTACHMENTS' using errcode = 'P0001';
  end if;

  -- Путь принимаем только свой и только существующий: иначе в обращение можно
  -- было бы записать ссылку на чужой объект и показать её админу.
  foreach v_file in array v_files loop
    if split_part(v_file, '/', 1) <> v_author::text then
      raise exception 'ATTACHMENT_FOREIGN' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'support-attachments' and o.name = v_file
    ) then
      raise exception 'ATTACHMENT_MISSING' using errcode = 'P0001';
    end if;
  end loop;

  -- Защита от шума. Функция общая и принимает произвольное действие; лог
  -- ведётся в homework_action_log — таблица по имени про ДЗ, по сути общий
  -- журнал действий. Заводить второй такой же ради имени не стал.
  perform public._enforce_homework_rate_limit(v_author, 'support_request', 2, 10);

  select p.role, coalesce(nullif(btrim(p.full_name), ''), 'Без имени')
    into v_role, v_name
    from public.profiles p where p.id = v_author;

  v_role_label := case v_role
    when 'student' then 'Ученик'   when 'parent'  then 'Родитель'
    when 'teacher' then 'Преподаватель' when 'curator' then 'Куратор'
    when 'admin'   then 'Администратор' when 'owner'   then 'Владелец'
    else coalesce(v_role::text, '—') end;

  insert into public.support_requests
    (author_id, subject, message, page_path, author_role, author_name, attachments)
  values (v_author, v_subj, v_msg, v_page, v_role, v_name, v_files)
  returning id into v_id;

  -- Дальше только оповещение. Его сбой не должен потерять само обращение:
  -- запись уже в таблице, и админ увидит её в истории даже без Telegram.
  -- Причина уходит в notification_dispatch_errors (§47), молча не глотаем.
  begin
    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    select r.profile_id,
           'Сообщение о проблеме: ' || v_subj,
           v_name || ' (' || v_role_label || '): ' || left(v_msg, 200)
             || case when char_length(v_msg) > 200 then '…' else '' end,
           'warning',
           null,
           'support_request:' || v_id || ':' || r.profile_id
      from public.support_request_recipients() r
     on conflict do nothing;

    -- Payload карточки собирается из строки таблицы: текст один и тот же и
    -- в истории, и в Telegram. Пути вложений уходят как есть — ссылки на них
    -- воркер подпишет на момент отправки, хранить подписанные нельзя.
    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select r.profile_id,
           'telegram',
           'support_request',
           'support_request',
           v_id,
           'support_request:' || v_id || ':' || r.profile_id,
           jsonb_build_object(
             'subject',     v_subj,
             'author_name', v_name,
             'author_role', v_role_label,
             'page_path',   v_page,
             'created_at',  to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'),
             'message',     v_msg,
             'attachments', to_jsonb(v_files)
           ),
           'pending'::notification_queue_status,
           now()
      from public.support_request_recipients() r
      join public.telegram_connections tc
        on tc.profile_id = r.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
     on conflict (deduplication_key) do nothing;
  exception when others then
    perform public.notification_log_dispatch_error(
      'submit_support_request', v_id, sqlstate, sqlerrm);
  end;

  return v_id;
end $function$;

comment on function public.submit_support_request(text, text, text, text[]) is
  'Приём обращения «Сообщить о проблеме». Автор — всегда auth.uid(), подать чужое нельзя по построению. Контекст (страница, роль, имя, время) собирается здесь, пользователь передаёт тему, текст и пути своих вложений.';

alter function public.submit_support_request(text, text, text, text[]) owner to postgres;
revoke all on function public.submit_support_request(text, text, text, text[]) from public, anon;
grant execute on function public.submit_support_request(text, text, text, text[]) to authenticated;
