set local lock_timeout = '4s';

alter table public.topic_homework
  add column photo_task_numbers text[] not null default '{}',
  add constraint topic_homework_photo_task_numbers_check check (
    cardinality(photo_task_numbers) <= 30
    and array_position(photo_task_numbers, null) is null
    and (
      cardinality(photo_task_numbers) = 0
      or array_to_string(photo_task_numbers, ',') ~ '^[1-9][0-9]{0,5}(\.[1-9][0-9]{0,5})?(,[1-9][0-9]{0,5}(\.[1-9][0-9]{0,5})?)*$'
    )
  );

alter table public.topic_homework_attempts
  add column photo_task_numbers text[] not null default '{}';

alter table public.topic_homework_attempt_files
  add column photo_task_number text;

create unique index topic_homework_attempt_files_photo_path_idx
  on public.topic_homework_attempt_files (storage_path)
  where photo_task_number is not null;

create function public.guard_topic_homework_photo_numbers()
returns trigger language plpgsql set search_path = '' as $$
begin
  if cardinality(new.photo_task_numbers) > 0 then
    if new.autocheck then
      raise exception 'Укажите номера в домашнем задании с рабочим листом.';
    end if;
    if (select count(distinct number) from unnest(new.photo_task_numbers) as number)
        <> cardinality(new.photo_task_numbers) then
      raise exception 'Уберите повторяющиеся номера.';
    end if;
    if exists (select 1 from public.topics t where t.id = new.topic_id and t.kind in ('check', 'control')) then
      raise exception 'Загрузка фото по номерам доступна для домашних заданий урока.';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_topic_homework_photo_numbers
before insert or update of photo_task_numbers, topic_id, autocheck on public.topic_homework
for each row execute function public.guard_topic_homework_photo_numbers();

create function public.guard_topic_homework_photo_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select h.photo_task_numbers into new.photo_task_numbers
      from public.topic_homework h where h.id = new.homework_id;
    return new;
  end if;

  if new.photo_task_numbers is distinct from old.photo_task_numbers
      or (cardinality(old.photo_task_numbers) > 0 and new.homework_id is distinct from old.homework_id) then
    raise exception 'Список номеров начатой работы менять нельзя.';
  end if;

  if old.status = 'draft' and new.status = 'submitted' and cardinality(old.photo_task_numbers) > 0
    and coalesce(current_setting('app.topic_homework_incomplete_photos', true), '') <> old.id::text
    and exists (
      select 1 from unnest(old.photo_task_numbers) as task(number)
      where not exists (
        select 1 from public.topic_homework_attempt_files f
        join storage.objects o on o.bucket_id = 'topic-homework-attempts' and o.name = f.storage_path
        where f.attempt_id = old.id and f.photo_task_number = task.number
      )
    ) then
    raise exception 'Прикрепите фото решения к каждому номеру перед сдачей.';
  end if;
  return new;
end;
$$;

create trigger guard_topic_homework_photo_submission
before insert or update on public.topic_homework_attempts
for each row execute function public.guard_topic_homework_photo_submission();

create function public.topic_homework_submit_incomplete_photos(p_attempt_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.topic_homework_attempts a
    where a.id = p_attempt_id and a.student_id = public.auth_student_id()
      and a.status = 'draft' and cardinality(a.photo_task_numbers) > 0
  ) then
    raise exception 'Черновик работы с фото не найден.';
  end if;

  perform set_config('app.topic_homework_incomplete_photos', p_attempt_id::text, true);
  perform public.topic_homework_submit_attempt(p_attempt_id);
  perform set_config('app.topic_homework_incomplete_photos', '', true);
end;
$$;

revoke execute on function public.topic_homework_submit_incomplete_photos(uuid) from public, anon;
grant execute on function public.topic_homework_submit_incomplete_photos(uuid) to authenticated;

create function public.guard_topic_homework_photo_file()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  attempt public.topic_homework_attempts%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.photo_task_number is not null then
      select * into attempt from public.topic_homework_attempts a where a.id = old.attempt_id for update;
      if found and attempt.status <> 'draft' and auth.uid() is not null
          and coalesce(current_setting('app.course_delete', true), '') <> 'on' then
        raise exception 'Сданные фотографии изменять нельзя.';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.photo_task_number is not null
      and (old.attempt_id, old.photo_task_number, old.storage_path, old.mime_type)
        is distinct from (new.attempt_id, new.photo_task_number, new.storage_path, new.mime_type) then
    raise exception 'Загрузите фото заново, чтобы изменить привязку.';
  end if;

  select * into attempt from public.topic_homework_attempts a
  where a.id = new.attempt_id and (cardinality(a.photo_task_numbers) > 0 or new.photo_task_number is not null)
  for update;
  if not found then
    return new;
  end if;

  if attempt.status <> 'draft' then
    raise exception 'Сданные фотографии изменять нельзя.';
  end if;
  if new.photo_task_number is null or not (new.photo_task_number = any(attempt.photo_task_numbers)) then
    raise exception 'Выберите номер из списка этой работы.';
  end if;
  if split_part(new.storage_path, '/', 1) is distinct from attempt.id::text
      or new.mime_type is null
      or new.mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
      or not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'topic-homework-attempts' and o.name = new.storage_path
          and o.metadata ->> 'mimetype' = new.mime_type
      ) then
    raise exception 'Для этого номера загрузите фото решения.';
  end if;
  return new;
end;
$$;

create trigger guard_topic_homework_photo_file
before insert or update or delete on public.topic_homework_attempt_files
for each row execute function public.guard_topic_homework_photo_file();

-- The regular file-removal flow removes the draft attachment first, then the
-- object. Block direct replacement or removal of an attached task photograph.
create policy topic_homework_task_photo_delete on storage.objects
as restrictive for delete to authenticated using (
  bucket_id <> 'topic-homework-attempts'
  or not exists (
    select 1 from public.topic_homework_attempt_files f
    where f.storage_path = name and f.photo_task_number is not null
  )
);

create policy topic_homework_task_photo_update on storage.objects
as restrictive for update to authenticated
using (
  bucket_id <> 'topic-homework-attempts'
  or not exists (
    select 1 from public.topic_homework_attempt_files f
    where f.storage_path = name and f.photo_task_number is not null
  )
)
with check (
  bucket_id <> 'topic-homework-attempts'
  or not exists (
    select 1 from public.topic_homework_attempt_files f
    where f.storage_path = name and f.photo_task_number is not null
  )
);

-- Course staff receive tagged photos only once the student has submitted them.
create policy topic_homework_task_photo_attachment_read on public.topic_homework_attempt_files
as restrictive for select to authenticated using (
  photo_task_number is null
  or public.topic_homework_attempt_is_own(attempt_id)
  or exists (select 1 from public.topic_homework_attempts a where a.id = attempt_id and a.status <> 'draft')
);

create policy topic_homework_task_photo_storage_read on storage.objects
as restrictive for select to authenticated using (
  bucket_id <> 'topic-homework-attempts'
  or not exists (
    select 1 from public.topic_homework_attempts a
    where a.id::text = split_part(name, '/', 1)
    and a.status = 'draft'
    and cardinality(a.photo_task_numbers) > 0
    and a.student_id is distinct from (select public.auth_student_id())
  )
);

revoke execute on function public.guard_topic_homework_photo_numbers(),
  public.guard_topic_homework_photo_submission(), public.guard_topic_homework_photo_file()
from public, anon, authenticated;
