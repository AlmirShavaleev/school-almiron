-- Кнопка «Сообщить о проблеме»: хранилище обращений и приём.
--
-- Образец — notify_homework_submitted (§47): вставку в notifications и
-- notification_queue делает SECURITY DEFINER-функция, клиентских
-- insert-политик у этих таблиц нет и заводить их нельзя.
--
-- Отличие от §47: там definer нужен был только для блока уведомления, а тело
-- сдачи обязано было остаться invoker — RLS держала право на чужую попытку.
-- Здесь защищать через RLS нечего: автор обращения всегда auth.uid(), подать
-- чужое нельзя по построению. Поэтому definer вся RPC целиком.

-- 1. Хранилище обращений ------------------------------------------------

create table if not exists public.support_requests (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles(id) on delete cascade,
  message      text not null,
  -- Контекст собирается автоматически, руками пользователь пишет только суть.
  page_path    text,
  author_role  public.user_role,
  author_name  text,
  status       text not null default 'new',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id),

  constraint support_requests_message_len check (char_length(message) between 10 and 2000),
  constraint support_requests_page_len    check (page_path is null or char_length(page_path) <= 300),
  constraint support_requests_status_known check (status in ('new', 'in_progress', 'closed'))
);

comment on table public.support_requests is
  'Обращения «Сообщить о проблеме» из интерфейса. Пишет только submit_support_request (SECURITY DEFINER): клиентских insert-политик нет и заводить их нельзя. Роль и имя автора сохраняются копией на момент обращения — профиль потом может смениться, а разбирать надо то, что было.';

create index if not exists idx_support_requests_created_at
  on public.support_requests (created_at desc);
create index if not exists idx_support_requests_status
  on public.support_requests (status, created_at desc) where status <> 'closed';
create index if not exists idx_support_requests_author
  on public.support_requests (author_id, created_at desc);

alter table public.support_requests enable row level security;

drop policy if exists support_requests_select_admin on public.support_requests;
create policy support_requests_select_admin on public.support_requests
  for select using (public.is_admin_or_owner());

-- Автор видит свои обращения: иначе «я писал, и что?» проверить нечем.
drop policy if exists support_requests_select_own on public.support_requests;
create policy support_requests_select_own on public.support_requests
  for select using (author_id = auth.uid());

drop policy if exists support_requests_update_admin on public.support_requests;
create policy support_requests_update_admin on public.support_requests
  for update using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

revoke all on table public.support_requests from public, anon, authenticated;
grant select, update on table public.support_requests to authenticated;

-- 2. Получатели: admin/owner, а не захардкоженный профиль владельца -------

create or replace function public.support_request_recipients()
  returns table(profile_id uuid)
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select p.id from public.profiles p where p.role in ('admin', 'owner');
$function$;

comment on function public.support_request_recipients() is
  'Кому уходят обращения «Сообщить о проблеме»: все admin/owner. Сегодня это один владелец, завтра — кто будет; хардкодить профиль нельзя.';

alter function public.support_request_recipients() owner to postgres;
revoke all on function public.support_request_recipients() from public, anon, authenticated;

-- 3. Приём обращения ------------------------------------------------------

create or replace function public.submit_support_request(
  p_message   text,
  p_page_path text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_author uuid := auth.uid();
  v_role   public.user_role;
  v_name   text;
  v_msg    text := btrim(coalesce(p_message, ''));
  v_page   text := nullif(left(btrim(coalesce(p_page_path, '')), 300), '');
  v_id     uuid;
  v_role_label text;
begin
  if v_author is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Длина: снизу — чтобы «ааа» не считалось обращением, сверху — чтобы
  -- карточка в Telegram не упёрлась в лимит сообщения.
  if char_length(v_msg) < 10 then
    raise exception 'MESSAGE_TOO_SHORT' using errcode = 'P0001';
  end if;
  if char_length(v_msg) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001';
  end if;

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

  insert into public.support_requests (author_id, message, page_path, author_role, author_name)
  values (v_author, v_msg, v_page, v_role, v_name)
  returning id into v_id;

  -- Дальше только оповещение. Его сбой не должен потерять само обращение:
  -- запись уже в таблице, и админ увидит её в истории даже без Telegram.
  -- Причина уходит в notification_dispatch_errors (§47), молча не глотаем.
  begin
    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    select r.profile_id,
           'Сообщение о проблеме',
           v_name || ' (' || v_role_label || '): ' || left(v_msg, 200)
             || case when char_length(v_msg) > 200 then '…' else '' end,
           'warning',
           null,
           'support_request:' || v_id || ':' || r.profile_id
      from public.support_request_recipients() r
     on conflict do nothing;

    -- Payload карточки собирается из строки таблицы: текст один и тот же и
    -- в истории, и в Telegram.
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
             'author_name', v_name,
             'author_role', v_role_label,
             'page_path',   v_page,
             'created_at',  to_char(now() at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'),
             'message',     v_msg
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

comment on function public.submit_support_request(text, text) is
  'Приём обращения «Сообщить о проблеме». Автор — всегда auth.uid(), подать чужое нельзя по построению. Контекст (страница, роль, имя, время) собирается здесь, пользователь передаёт только текст.';

alter function public.submit_support_request(text, text) owner to postgres;
revoke all on function public.submit_support_request(text, text) from public, anon;
grant execute on function public.submit_support_request(text, text) to authenticated;
