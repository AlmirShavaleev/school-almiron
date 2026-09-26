-- §231. Права на пробники: запись и чтение mock_exams и mock_exam_results —
-- только персоналу курса ГРУППЫ пробника, а не любому преподавателю по роли.
--
-- Только добавляющая: три новые функции (create or replace), политики —
-- drop policy if exists + create policy. Таблицы, колонки, триггеры и
-- существующие функции не тронуты. Повторный прогон — без ошибок и без
-- изменений (проба в supabase/tests/mock_exam_rights_231/run.sh).
--
-- Зачем. С §215 на проде стояли политики из _legacy/002_rls.sql:
--   mock_exams_manage        FOR ALL USING (is_admin_or_owner() OR get_my_role() = 'teacher')
--   mock_exams_select        teacher/curator по роли видят ВСЕ пробники школы (+ ученики своей группы)
--   mock_exam_results_manage FOR ALL USING (is_admin_or_owner() OR get_my_role() = 'teacher')
-- То есть любой преподаватель мог завести пробник в чужую группу, переписать
-- или удалить чужой пробник (каскадом — с работами, фото и баллами учеников) и
-- читать/править итоги любой группы. Остальные таблицы пробника с §218/§221/§229
-- уже закрыты через mock_exam_is_staff / mock_exam_can_manage; эти две
-- остались дырой (§215 «увидено и НЕ тронуто», §228 «оставлено в очередь»).
--
-- Правило то же, что у соседних таблиц, своего не изобретаем:
--   читать  — персонал курса группы пробника (course_is_staff: админ платформы,
--             владелец курса, преподаватель группы, куратор группы/курса);
--   писать  — тот же персонал С РОЛЬЮ teacher или админ платформы
--             (mock_exam_can_manage, §221); куратор читает, но не управляет.
--
-- Пробник без группы (group_id is null). Появляется двумя путями: девять
-- образцов прода заведены так до §218 (форма тогда группу не требовала), и
-- groups → mock_exams ON DELETE SET NULL: удалили группу (ArchiveGroupModal
-- удаляет) — пробник остаётся без группы. Нынешняя форма (§228) без группы не
-- создаёт. Курса у такого пробника нет, значит персонала курса тоже нет. Видит
-- и может поправить/удалить его АВТОР (created_by — его строка teachers, роль
-- teacher) и админ платформы: иначе пробник удалённой группы навсегда повис
-- бы у одного админа, а автору нечем было бы его убрать или перенести в свою
-- группу. Итоги такого пробника — только админу (ввести их нельзя: у
-- save_mock_exam_grid без группы отказ 22023).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Помощники по ГРУППЕ
-- ──────────────────────────────────────────────────────────────────────────
-- mock_exam_is_staff / mock_exam_can_manage (§218/§221) принимают id
-- пробника и сами читают его группу. В политиках самой mock_exams нужна
-- проверка по КОЛОНКЕ строки: при вставке строки ещё нет, а в WITH CHECK
-- обновления функция по id прочла бы СТАРУЮ группу, а не ту, в которую
-- пробник переносят. Правило внутри то же: группа → курс → course_is_staff
-- (+ роль, как в mock_exam_can_manage).

create or replace function public.mock_exam_group_is_staff(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.groups g
     where g.id = p_group_id
       and public.course_is_staff(g.course_id)
  );
$$;

comment on function public.mock_exam_group_is_staff(uuid) is
  '§231. Персонал ли вызывающий по курсу этой группы (путь группа → курс; правило — course_is_staff). Для политик mock_exams, где проверяется колонка group_id строки.';

create or replace function public.mock_exam_group_can_manage(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mock_exam_group_is_staff(p_group_id)
     and (public.is_admin_or_owner() or public.get_my_role() = 'teacher');
$$;

comment on function public.mock_exam_group_can_manage(uuid) is
  '§231. Может ли вызывающий заводить и настраивать пробники этой группы: персонал курса группы с ролью teacher или админ платформы — то же условие, что mock_exam_can_manage (§221), но по группе.';

-- Автор пробника: created_by — ссылка на teachers.id, не на profiles.id.
-- security definer — чтобы не зависеть от политик teachers.
create or replace function public.mock_exam_is_my_teacher(p_teacher_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_teacher_id is not null and exists (
    select 1 from public.teachers t
     where t.id = p_teacher_id and t.profile_id = auth.uid()
  );
$$;

comment on function public.mock_exam_is_my_teacher(uuid) is
  '§231. Строка teachers с этим id — вызывающего? (created_by пробника — teachers.id, не profiles.id).';

revoke all on function public.mock_exam_group_is_staff(uuid) from public, anon;
revoke all on function public.mock_exam_group_can_manage(uuid) from public, anon;
revoke all on function public.mock_exam_is_my_teacher(uuid) from public, anon;
grant execute on function public.mock_exam_group_is_staff(uuid) to authenticated;
grant execute on function public.mock_exam_group_can_manage(uuid) to authenticated;
grant execute on function public.mock_exam_is_my_teacher(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. mock_exams
-- ──────────────────────────────────────────────────────────────────────────
alter table public.mock_exams enable row level security;

drop policy if exists "mock_exams_manage" on public.mock_exams;
drop policy if exists "mock_exams_select" on public.mock_exams;

-- Чтение: админ; персонал курса группы (куратор — тоже); автор пробника без
-- группы; ученики группы — ветка учеников дословно прежняя (§215).
create policy "mock_exams_select" on public.mock_exams
  for select to authenticated
  using (
    public.is_admin_or_owner()
    or public.mock_exam_group_is_staff(group_id)
    or (group_id is null and public.mock_exam_is_my_teacher(created_by))
    or exists (
      select 1 from group_students gs join students s on s.id = gs.student_id
      where gs.group_id = mock_exams.group_id and s.profile_id = auth.uid()
    )
  );

-- Создание: только в группу, которой вызывающий управляет. Автором можно
-- записать только себя (или никого — так пишет владелец без строки teachers,
-- §219); админ платформы — без ограничений (заводит и за других).
drop policy if exists "mock_exams_insert" on public.mock_exams;
create policy "mock_exams_insert" on public.mock_exams
  for insert to authenticated
  with check (
    public.is_admin_or_owner()
    or (public.mock_exam_group_can_manage(group_id)
        and (created_by is null or public.mock_exam_is_my_teacher(created_by)))
  );

-- Правка: USING — строка ДО правки (пробник группы, которой управляешь, или
-- свой пробник без группы), WITH CHECK — строка ПОСЛЕ: перенести пробник
-- можно только в группу, которой тоже управляешь. Проверку «нет работ и
-- баллов» и понятный текст ошибки при переносе в чужой курс по-прежнему даёт
-- триггер mock_exams_group_change_guard (§228) — он BEFORE и срабатывает
-- раньше этой проверки; здесь — вторая стена на случай, когда триггер
-- пропускает (он смотрит course_is_staff без роли: куратор-преподаватель).
drop policy if exists "mock_exams_update" on public.mock_exams;
create policy "mock_exams_update" on public.mock_exams
  for update to authenticated
  using (
    public.is_admin_or_owner()
    or public.mock_exam_group_can_manage(group_id)
    or (group_id is null and public.get_my_role() = 'teacher' and public.mock_exam_is_my_teacher(created_by))
  )
  with check (
    public.is_admin_or_owner()
    or public.mock_exam_group_can_manage(group_id)
    or (group_id is null and public.get_my_role() = 'teacher' and public.mock_exam_is_my_teacher(created_by))
  );

-- Удаление (каскадом уходят бланки, фото, баллы, итоги) — кто управляет.
drop policy if exists "mock_exams_delete" on public.mock_exams;
create policy "mock_exams_delete" on public.mock_exams
  for delete to authenticated
  using (
    public.is_admin_or_owner()
    or public.mock_exam_group_can_manage(group_id)
    or (group_id is null and public.get_my_role() = 'teacher' and public.mock_exam_is_my_teacher(created_by))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. mock_exam_results
-- ──────────────────────────────────────────────────────────────────────────
-- Клиент напрямую итоги не пишет: пишут save_mock_exam_grid (§218, security
-- INVOKER — поэтому политики записи нужны) и grade_mock_exam_part1 через неё;
-- notify_mock_exam_results и пересчёт шкалы — definer. Ученик свой итог
-- читает функциями my_mock_exam_result / my_mock_exams (definer) — политики
-- для него не нужно, и её нет (как с §215). Родителю итоги отдаёт definer
-- student_progress_report (§217).
alter table public.mock_exam_results enable row level security;

drop policy if exists "mock_exam_results_manage" on public.mock_exam_results;
-- В _legacy/002_rls.sql была ещё mock_exam_results_select (роль teacher/curator,
-- ученик, родитель); на проде её нет с §215 — снимаем на всякий случай, чтобы
-- после этой миграции политик на чтение было ровно одна.
drop policy if exists "mock_exam_results_select" on public.mock_exam_results;

drop policy if exists "mock_exam_results_staff_select" on public.mock_exam_results;
create policy "mock_exam_results_staff_select" on public.mock_exam_results
  for select to authenticated
  using (public.is_admin_or_owner() or public.mock_exam_is_staff(mock_exam_id));

drop policy if exists "mock_exam_results_manage_insert" on public.mock_exam_results;
create policy "mock_exam_results_manage_insert" on public.mock_exam_results
  for insert to authenticated
  with check (public.is_admin_or_owner() or public.mock_exam_can_manage(mock_exam_id));

drop policy if exists "mock_exam_results_manage_update" on public.mock_exam_results;
create policy "mock_exam_results_manage_update" on public.mock_exam_results
  for update to authenticated
  using (public.is_admin_or_owner() or public.mock_exam_can_manage(mock_exam_id))
  with check (public.is_admin_or_owner() or public.mock_exam_can_manage(mock_exam_id));

drop policy if exists "mock_exam_results_manage_delete" on public.mock_exam_results;
create policy "mock_exam_results_manage_delete" on public.mock_exam_results
  for delete to authenticated
  using (public.is_admin_or_owner() or public.mock_exam_can_manage(mock_exam_id));

-- ──────────────────────────────────────────────────────────────────────────
-- 4. mock_exam_task_scores — запись тоже только тому, кто управляет
-- ──────────────────────────────────────────────────────────────────────────
-- §218 открыл запись баллов по заданиям всему персоналу курса
-- (mock_exam_is_staff), включая куратора, а итоги — только преподавателю. Итог:
-- куратор не может сохранить строку с баллами (итог упирается в RLS, вся
-- транзакция откатывается), но может строкой из пустых клеток или прямым
-- DELETE стереть баллы по заданиям, оставив итог. Приводим к правилу соседних
-- таблиц (§221/§229): читает персонал, пишет mock_exam_can_manage. Чтение
-- (mock_exam_task_scores_staff_select) не трогаем.
drop policy if exists mock_exam_task_scores_staff_insert on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_insert
  on public.mock_exam_task_scores
  for insert to authenticated
  with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_task_scores_staff_update on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_update
  on public.mock_exam_task_scores
  for update to authenticated
  using (public.mock_exam_can_manage(mock_exam_id))
  with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_task_scores_staff_delete on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_delete
  on public.mock_exam_task_scores
  for delete to authenticated
  using (public.mock_exam_can_manage(mock_exam_id));
