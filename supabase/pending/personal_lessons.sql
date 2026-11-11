-- Personal one-to-one lessons. Apply only when deploying work/personal-lessons.
-- No changes to subscriptions or existing payments.
create table public.tutoring_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 meeting_url text not null default '', updated_at timestamptz not null default now(),
 check(meeting_url = '' or meeting_url ~ '^https://telemost\.(yandex\.(ru|com)|360\.yandex\.ru)/')
);
insert into public.tutoring_settings(id) values(true);
create table public.tutoring_slots (
 id uuid primary key default gen_random_uuid(), starts_at timestamptz not null,
 is_open boolean not null default true, created_at timestamptz not null default now()
);
create unique index tutoring_slots_start on public.tutoring_slots(starts_at);
create table public.tutoring_bookings (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
 slot_id uuid not null references public.tutoring_slots(id),
 subject text not null check(subject in ('math','physics')), question text not null check(length(question) between 5 and 3000),
 status text not null default 'pending' check(status in ('pending','paid','expired','canceled','payment_conflict','refunded')),
 amount_rub numeric not null default 1500 check(amount_rub = 1500),
 reserved_until timestamptz not null default now()+interval '15 minutes',
 yookassa_id text unique, confirmation_url text, paid_at timestamptz,
 meeting_url text, receipt_email text not null, payment_status text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index tutoring_one_booking_per_slot on public.tutoring_bookings(slot_id) where status in ('pending','paid');
create index tutoring_bookings_profile on public.tutoring_bookings(profile_id,created_at desc);
create table public.tutoring_events (
 id bigint generated always as identity primary key, booking_id uuid not null references public.tutoring_bookings(id),
 event text not null, actor uuid, created_at timestamptz not null default now(), details jsonb not null default '{}'
);
alter table public.tutoring_settings enable row level security;
alter table public.tutoring_slots enable row level security;
alter table public.tutoring_bookings enable row level security;
alter table public.tutoring_events enable row level security;
revoke all on public.tutoring_settings,public.tutoring_slots,public.tutoring_bookings,public.tutoring_events from anon,authenticated;
-- All access is via scoped RPCs: private meeting links never enter slot listings.
create function public.tutoring_list() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
 'enabled',coalesce((select enabled from tutoring_settings where id),false),
 'server_now',now(),'duration_minutes',45,'price_rub',1500,
 'slots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at) order by s.starts_at)
 from tutoring_slots s where s.is_open and s.starts_at>now() and s.starts_at<now()+interval '90 days'
 and not exists(select 1 from tutoring_bookings b where b.slot_id=s.id and (b.status='paid' or b.status='pending' and b.reserved_until>now()))),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'slot_id',b.slot_id,'starts_at',s.starts_at,
 'subject',b.subject,'question',b.question,'status',b.status,'reserved_until',b.reserved_until,'amount_rub',b.amount_rub,
 'meeting_url',case when b.status='paid' then b.meeting_url end,'confirmation_url',case when b.status='pending' and b.reserved_until>now() then b.confirmation_url end)
 order by s.starts_at desc) from tutoring_bookings b join tutoring_slots s on s.id=b.slot_id where b.profile_id=auth.uid()),'[]'::jsonb)
);
$$;
create function public.tutoring_admin_list() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.is_admin_or_owner() then raise exception 'Нет доступа' using errcode='42501'; end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from tutoring_settings s where id),
 'slots',coalesce((select jsonb_agg(to_jsonb(s) order by starts_at) from tutoring_slots s where starts_at>now()-interval '30 days'),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('starts_at',s.starts_at,'name',p.full_name) order by s.starts_at desc)
 from tutoring_bookings b join tutoring_slots s on s.id=b.slot_id join profiles p on p.id=b.profile_id),'[]'::jsonb));
end $$;
create function public.tutoring_admin_settings(p_enabled boolean,p_meeting_url text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_admin_or_owner() then raise exception 'Нет доступа' using errcode='42501'; end if;
 if p_enabled and coalesce(p_meeting_url,'')='' then raise exception 'Сначала укажите ссылку Телемоста'; end if;
 update tutoring_settings set enabled=p_enabled,meeting_url=btrim(p_meeting_url),updated_at=now() where id;
end $$;
create function public.tutoring_admin_slot(p_starts_at timestamptz,p_id uuid default null,p_open boolean default true) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 if not public.is_admin_or_owner() then raise exception 'Нет доступа' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(74150945);
 if p_id is not null then
  -- A booked time cannot be deleted or edited; closing only stops new bookings.
  update tutoring_slots set is_open=p_open where id=p_id returning id into v_id;
 else
  if p_starts_at<=now() or p_starts_at>now()+interval '90 days' then raise exception 'Выберите время в ближайшие 90 дней'; end if;
  if exists(select 1 from tutoring_slots where starts_at<p_starts_at+interval '45 minutes' and starts_at+interval '45 minutes'>p_starts_at) then
   raise exception 'Это время пересекается с другим занятием'; end if;
  insert into tutoring_slots(starts_at) values(p_starts_at) returning id into v_id;
 end if;
 return v_id;
end $$;
create function public.tutoring_reserve(p_slot_id uuid,p_subject text,p_question text,p_email text,p_consent boolean) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_slot tutoring_slots%rowtype; v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role::text='student') then raise exception 'Войдите как ученик' using errcode='42501'; end if;
 if not exists(select 1 from tutoring_settings where id and enabled and meeting_url<>'') then raise exception 'Запись пока не открыта'; end if;
 if p_consent is distinct from true then raise exception 'Подтвердите условия записи'; end if;
 if p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Укажите email для чека'; end if;
 select * into v_slot from tutoring_slots where id=p_slot_id for update;
 if not found or not v_slot.is_open or v_slot.starts_at<=now() then raise exception 'Это время уже недоступно'; end if;
 update tutoring_bookings set status='expired',updated_at=now() where slot_id=p_slot_id and status='pending' and reserved_until<=now();
 select id into v_id from tutoring_bookings where slot_id=p_slot_id and profile_id=auth.uid() and status='pending' and reserved_until>now();
 if v_id is not null then return v_id; end if;
 if exists(select 1 from tutoring_bookings where slot_id=p_slot_id and status in ('pending','paid')) then raise exception 'Это время уже занято'; end if;
 if (select count(*) from tutoring_bookings where profile_id=auth.uid() and status='pending' and reserved_until>now())>=3 then raise exception 'Завершите уже начатую оплату'; end if;
 insert into tutoring_bookings(profile_id,slot_id,subject,question,receipt_email)
 values(auth.uid(),p_slot_id,p_subject,btrim(p_question),btrim(p_email)) returning id into v_id;
 insert into tutoring_events(booking_id,event,actor) values(v_id,'reserved_with_consent',auth.uid());
 return v_id;
end $$;
create function public.tutoring_reschedule(p_booking_id uuid,p_slot_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_booking tutoring_bookings%rowtype; v_start timestamptz; v_new tutoring_slots%rowtype;
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт' using errcode='42501'; end if;
 -- Serialize moves and slot creation to prevent reciprocal transfer deadlocks.
 perform pg_advisory_xact_lock(74150945);
 select * into v_booking from tutoring_bookings where id=p_booking_id and profile_id=auth.uid();
 if not found or v_booking.status<>'paid' then raise exception 'Перенести можно только оплаченное занятие'; end if;
 select starts_at into v_start from tutoring_slots where id=v_booking.slot_id for update;
 perform 1 from tutoring_bookings where id=p_booking_id for update;
 if v_start-now()<interval '2 hours' then raise exception 'Перенос доступен не позднее чем за 2 часа до занятия'; end if;
 if v_booking.slot_id=p_slot_id then return; end if;
 select * into v_new from tutoring_slots where id=p_slot_id for update;
 if not found or not v_new.is_open or v_new.starts_at<=now() then raise exception 'Выберите свободное время'; end if;
 update tutoring_bookings set status='expired',updated_at=now() where slot_id=p_slot_id and status='pending' and reserved_until<=now();
 if exists(select 1 from tutoring_bookings where slot_id=p_slot_id and status in ('pending','paid')) then raise exception 'Это время уже занято'; end if;
 update tutoring_bookings set slot_id=p_slot_id,updated_at=now() where id=p_booking_id;
 insert into tutoring_events(booking_id,event,actor,details) values(p_booking_id,'rescheduled',auth.uid(),jsonb_build_object('from',v_start,'to',v_new.starts_at));
end $$;
-- Service-only entrypoint. HTTP code verifies amount, metadata and real provider status.
create function public.tutoring_apply_payment(p_id uuid,p_yookassa_id text,p_status text,p_amount numeric) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare b tutoring_bookings%rowtype; v_slot uuid; v_url text;
begin
 select slot_id into v_slot from tutoring_bookings where id=p_id;
 perform 1 from tutoring_slots where id=v_slot for update;
 select * into b from tutoring_bookings where id=p_id for update;
 if not found or b.yookassa_id is distinct from p_yookassa_id or p_amount is distinct from b.amount_rub then raise exception 'Несовпадение платежа'; end if;
 if b.status in ('paid','refunded','payment_conflict') then return b.status; end if;
 if p_status='succeeded' then
  if exists(select 1 from tutoring_bookings where slot_id=b.slot_id and id<>b.id and (status='paid' or status='pending' and reserved_until>now()))
   or exists(select 1 from tutoring_slots where id=b.slot_id and starts_at<=now()) then
   update tutoring_bookings set status='payment_conflict',payment_status=p_status,paid_at=now(),updated_at=now() where id=b.id;
   insert into tutoring_events(booking_id,event) values(b.id,'payment_conflict'); return 'payment_conflict';
  end if;
  update tutoring_bookings set status='expired' where slot_id=b.slot_id and id<>b.id and status='pending' and reserved_until<=now();
  select meeting_url into v_url from tutoring_settings where id;
  update tutoring_bookings set status='paid',payment_status=p_status,paid_at=now(),meeting_url=v_url,updated_at=now() where id=b.id;
  insert into tutoring_events(booking_id,event) values(b.id,'paid'); return 'paid';
 elsif p_status='canceled' then
  update tutoring_bookings set status='canceled',payment_status=p_status,updated_at=now() where id=b.id;
 else
  update tutoring_bookings set payment_status=p_status,updated_at=now() where id=b.id;
 end if;
 return p_status;
end $$;
-- Revoke PostgreSQL's default PUBLIC EXECUTE, then grant precise entrypoints.
revoke all on function public.tutoring_list(),public.tutoring_admin_list(),public.tutoring_admin_settings(boolean,text),public.tutoring_admin_slot(timestamptz,uuid,boolean),public.tutoring_reserve(uuid,text,text,text,boolean),public.tutoring_reschedule(uuid,uuid),public.tutoring_apply_payment(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.tutoring_list(),public.tutoring_admin_list(),public.tutoring_admin_settings(boolean,text),public.tutoring_admin_slot(timestamptz,uuid,boolean),public.tutoring_reserve(uuid,text,text,text,boolean),public.tutoring_reschedule(uuid,uuid) to authenticated;
grant execute on function public.tutoring_apply_payment(uuid,text,text,numeric) to service_role;
grant all on public.tutoring_bookings,public.tutoring_slots,public.tutoring_settings,public.tutoring_events to service_role;
grant usage,select on sequence public.tutoring_events_id_seq to service_role;

-- Public calendar: only available timestamps; private bookings remain scoped to auth.uid().
grant execute on function public.tutoring_list() to anon;
