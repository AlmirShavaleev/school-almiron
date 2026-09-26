-- Добавки слепка для §221.
-- modules / topics — по _legacy/001_schema.sql (колонки, нужные здесь), без RLS:
-- их политики здесь не проверяются.
create table modules (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now());
create table topics (
  id uuid primary key default uuid_generate_v4(),
  module_id uuid not null references modules(id) on delete cascade,
  title text not null,
  order_index integer not null default 0);
grant select on modules, topics to authenticated;

-- Хранилище: минимальный storage. Колонки объектов — подмножество настоящих;
-- storage.foldername — дословно по Supabase. Загрузку через Storage API
-- изображает insert под ролью authenticated: API пишет строку объекта под
-- токеном пользователя, и ровно эти политики решают, пустить ли.
create schema storage;
grant usage on schema storage to authenticated, anon;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default uuid_generate_v4(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;
-- Чужой бакет со своей политикой: проверить, что политики mock-exams не
-- ломают чужую загрузку с «кривым» первым сегментом пути.
insert into storage.buckets (id, name) values ('other', 'other');
create policy other_all on storage.objects for all to authenticated
  using (bucket_id = 'other') with check (bucket_id = 'other');
