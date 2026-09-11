-- Отметка присутствия падала на приведении роли.
--
-- `profiles.role` — это enum `user_role`, а не text. Запись
-- `coalesce(p.role, '')` заставляла Postgres приводить пустую строку к enum и
-- давала 22P02 «invalid input value for enum user_role». Поймано первой же
-- пробой под учеником, до клиента.
--
-- Правильно: сначала привести к тексту, потом подставлять умолчание —
-- `school_presence.role` хранится текстом намеренно, чтобы таблица
-- присутствия не зависела от состава enum.
create or replace function public.school_presence_touch()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- Только своя строка: profile_id берётся из auth.uid() и аргументом не
  -- задаётся в принципе. Роль — из профиля, а не от клиента: иначе список
  -- онлайн врал бы ролями.
  insert into public.school_presence (profile_id, role, seen_at)
  select p.id, coalesce(p.role::text, ''), now()
    from public.profiles p
   where p.id = auth.uid()
  on conflict (profile_id) do update
    set seen_at = excluded.seen_at,
        role    = excluded.role;
end;
$$;

revoke all on function public.school_presence_touch() from public, anon;
grant execute on function public.school_presence_touch() to authenticated;
