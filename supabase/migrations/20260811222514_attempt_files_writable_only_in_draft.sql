-- Правка страниц работы разрешена только в ЧЕРНОВИКЕ.
--
-- Было: и таблица `topic_homework_attempt_files`, и объекты Storage в бакете
-- `topic-homework-attempts` пускали на запись по `topic_homework_attempt_is_own`
-- — «попытка моя», без статуса. То есть ученик формально мог заменить или
-- удалить страницы уже ОТПРАВЛЕННОЙ, проверенной и возвращённой работы: RLS не
-- мешала, прятал только интерфейс. Подпись «после отправки страницы изменить
-- нельзя» была правдой про экран и неправдой про базу.
--
-- Общую `topic_homework_attempt_is_own` не трогаем сознательно: её же
-- спрашивают SELECT-политики, и сузить её значило бы отнять у ученика просмотр
-- собственной отправленной работы. Заводим отдельный предикат — «моя И
-- черновик» — и переключаем на него ТОЛЬКО пишущие политики.
--
-- Возвращённая на доработку попытка тоже замораживается: ученик сдаёт заново
-- новой попыткой (`canStartNewAttempt` = нет активной и нет принятой), поэтому
-- ничего не теряет, а история «что именно вернули» и пометки преподавателя
-- остаются привязанными к тем файлам, которые он смотрел (решение владельца
-- 2026-08-10).
create or replace function public.topic_homework_attempt_is_own_draft(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from topic_homework_attempts a
     where a.id = p_attempt_id
       and a.student_id = public.auth_student_id()
       and a.status = 'draft'
  );
$$;

revoke all on function public.topic_homework_attempt_is_own_draft(uuid) from public, anon;
grant execute on function public.topic_homework_attempt_is_own_draft(uuid) to authenticated, service_role;

comment on function public.topic_homework_attempt_is_own_draft(uuid) is
  'Моя попытка И она черновик. Только для ПИШУЩИХ политик страниц работы: после отправки состав страниц не меняется. Для чтения — topic_homework_attempt_is_own.';

-- ── Таблица страниц ──────────────────────────────────────────────────────
-- Была одна политика FOR ALL; разбиваем на три пишущие, чтение остаётся за
-- `topic_homework_attempt_files_select` (его не трогаем).
drop policy if exists topic_homework_attempt_files_student_write on public.topic_homework_attempt_files;

create policy topic_homework_attempt_files_student_insert
  on public.topic_homework_attempt_files
  for insert to authenticated
  with check (public.topic_homework_attempt_is_own_draft(attempt_id));

create policy topic_homework_attempt_files_student_update
  on public.topic_homework_attempt_files
  for update to authenticated
  using (public.topic_homework_attempt_is_own_draft(attempt_id))
  with check (public.topic_homework_attempt_is_own_draft(attempt_id));

create policy topic_homework_attempt_files_student_delete
  on public.topic_homework_attempt_files
  for delete to authenticated
  using (public.topic_homework_attempt_is_own_draft(attempt_id));

-- ── Сами файлы в Storage ────────────────────────────────────────────────
-- Без этого запрет половинчатый: строка осталась бы на месте, а содержимое
-- страницы ученик подменил бы или снёс уже после отправки.
drop policy if exists topic_homework_attempt_files_write on storage.objects;

create policy topic_homework_attempt_files_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'topic-homework-attempts'
    and public.topic_homework_attempt_is_own_draft(((storage.foldername(name))[1])::uuid)
  );

create policy topic_homework_attempt_files_update
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'topic-homework-attempts'
    and public.topic_homework_attempt_is_own_draft(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'topic-homework-attempts'
    and public.topic_homework_attempt_is_own_draft(((storage.foldername(name))[1])::uuid)
  );

create policy topic_homework_attempt_files_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'topic-homework-attempts'
    and public.topic_homework_attempt_is_own_draft(((storage.foldername(name))[1])::uuid)
  );
