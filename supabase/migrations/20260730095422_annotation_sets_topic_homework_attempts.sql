-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730095422
--   name    = annotation_sets_topic_homework_attempts
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Проверено на локальном Postgres 16 (RLS через set role authenticated +
-- request.jwt.claim.sub), 11 проб: CHECK ловит обе-NULL и обе-заполненные;
-- upsert по (attempt_id, file_path, page) обновляет строку, а не плодит дубли;
-- чужой преподаватель не видит и не может писать; ученик не видит черновик,
-- видит опубликованное, чужой ученик не видит и опубликованное; удаление
-- попытки каскадом уносит рамки.
-- ============================================================
-- Аннотации (рамки с ошибками) для нового контура ДЗ
-- ============================================================
-- annotation_sets умел ссылаться только на homework_submissions (старый
-- контур, на проде 0 строк). Весь живой трафик — на topic_homework_attempts.
-- Добавляем вторую цель, сохраняя старую: ровно одна из двух.

alter table public.annotation_sets
  add column attempt_id uuid references public.topic_homework_attempts(id) on delete cascade;

alter table public.annotation_sets alter column submission_id drop not null;

alter table public.annotation_sets
  add constraint annotation_sets_one_target_chk
  check (num_nonnulls(submission_id, attempt_id) = 1);

-- Индекс ПЛОСКИЙ, а не partial: PostgREST-овский upsert
-- (onConflict: 'attempt_id,file_path,page') не умеет использовать partial-индекс
-- как арбитра ON CONFLICT — для этого сам запрос должен нести WHERE, повторяющий
-- предикат индекса, а PostgREST его не добавляет. NULL-ы в уникальном индексе
-- по умолчанию считаются различными, поэтому legacy-строки (attempt_id is null)
-- друг другу не мешают, а их уникальность и так держит
-- unique (submission_id, file_path, page).
create unique index annotation_sets_attempt_file_page_key
  on public.annotation_sets(attempt_id, file_path, page);

create index idx_annotation_sets_attempt_status
  on public.annotation_sets(attempt_id, status);

comment on column public.annotation_sets.attempt_id is
  'Попытка ДЗ нового контура (topic_homework_attempts). Взаимоисключима с submission_id.';

-- ── RLS: к каждой политике добавляем ветку нового контура ──
-- Ветки старого контура сохранены дословно (auth_can_review_submission),
-- добавлен явный «submission_id is not null», чтобы для строк нового контура
-- подзапрос даже не выполнялся.
-- Право на новый контур: topic_homework_attempt_can_review (персонал курса —
-- то же, чем закрыты сами попытки и файлы), ученик — только опубликованное
-- и только своё (topic_homework_attempt_is_own), как и в старом контуре.

drop policy annotation_sets_select on public.annotation_sets;
create policy annotation_sets_select on public.annotation_sets
  for select using (
    is_admin_or_owner()
    or (submission_id is not null and exists (
          select 1 from homework_submissions hs
           where hs.id = annotation_sets.submission_id
             and auth_can_review_submission(hs.student_id, hs.homework_id)))
    or (submission_id is not null and status = 'published' and exists (
          select 1 from homework_submissions hs
            join students s on s.id = hs.student_id
           where hs.id = annotation_sets.submission_id
             and s.profile_id = auth.uid()))
    or (attempt_id is not null and public.topic_homework_attempt_can_review(attempt_id))
    or (attempt_id is not null and status = 'published'
        and public.topic_homework_attempt_is_own(attempt_id))
  );

drop policy annotation_sets_insert_staff on public.annotation_sets;
create policy annotation_sets_insert_staff on public.annotation_sets
  for insert with check (
    author_id = auth.uid()
    and (
      is_admin_or_owner()
      or (submission_id is not null and exists (
            select 1 from homework_submissions hs
             where hs.id = annotation_sets.submission_id
               and auth_can_review_submission(hs.student_id, hs.homework_id)))
      or (attempt_id is not null and public.topic_homework_attempt_can_review(attempt_id))
    )
  );

drop policy annotation_sets_update_staff on public.annotation_sets;
create policy annotation_sets_update_staff on public.annotation_sets
  for update using (
    is_admin_or_owner()
    or (submission_id is not null and exists (
          select 1 from homework_submissions hs
           where hs.id = annotation_sets.submission_id
             and auth_can_review_submission(hs.student_id, hs.homework_id)))
    or (attempt_id is not null and public.topic_homework_attempt_can_review(attempt_id))
  ) with check (
    is_admin_or_owner()
    or (submission_id is not null and exists (
          select 1 from homework_submissions hs
           where hs.id = annotation_sets.submission_id
             and auth_can_review_submission(hs.student_id, hs.homework_id)))
    or (attempt_id is not null and public.topic_homework_attempt_can_review(attempt_id))
  );

drop policy annotation_sets_delete_staff on public.annotation_sets;
create policy annotation_sets_delete_staff on public.annotation_sets
  for delete using (
    is_admin_or_owner()
    or (submission_id is not null and exists (
          select 1 from homework_submissions hs
           where hs.id = annotation_sets.submission_id
             and auth_can_review_submission(hs.student_id, hs.homework_id)))
    or (attempt_id is not null and public.topic_homework_attempt_can_review(attempt_id))
  );
