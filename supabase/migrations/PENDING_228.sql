-- §228. Пробник v3: группу пробника можно сменить, пока у него нет работ и баллов.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавляющая: одна функция и один триггер BEFORE UPDATE OF group_id на
-- mock_exams. Политики, таблицы и существующие функции НЕ тронуты.
--
-- Зачем. В форме «Новый пробник» / вкладке «Настройка» (§228) группа теперь
-- выбирается и меняется прямо в форме (владелец: «нужна опция выбора группы»).
-- Но у пробника группы — это и есть его ученики: баллы (mock_exam_task_scores),
-- бланки (mock_exam_sheets, строка появляется уже при первом заходе, §224),
-- итоги с отметкой отправки (mock_exam_results, §219) и фото (mock_exam_photos)
-- принадлежат ученикам ЭТОЙ группы. Переставить пробник на другую группу, когда
-- что-то из этого уже есть, значит оставить в нём чужие работы: таблица §218
-- их не покажет (ростер — новая группа), а итоги уйдут в отчёт родителю §217
-- под пробником другой группы. Молча переложить нельзя — поэтому отказ с
-- понятным текстом. Экран то же правило показывает заранее (чипы недоступны),
-- здесь — защита, которую экран не обойдёт.
--
-- Вторая проверка — куда переставляют: в группу курса, где вызывающий —
-- персонал (course_is_staff). Политика mock_exams_manage (§215, не тронута)
-- пускает к записи любого преподавателя по роли, и без этой проверки
-- преподаватель мог бы переставить пробник в группу чужого курса. Запись без
-- пользователя (auth.uid() is null — служебные правки владельца через SQL,
-- оркестратор) не ограничивается: её делает не экран.
--
-- Напоминания в Telegram при смене группы уже переставляет триггер §224
-- mock_exams_schedule_notifications (after update of group_id): pending
-- прежней группы гасятся, новой — ставятся. Этот триггер — BEFORE и при
-- отказе до него дело не доходит (проба G6 в supabase/tests/mock_exam_v3_228).

create or replace function public.mock_exams_group_change_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_what text[] := '{}';
  v_course uuid;
begin
  if new.group_id is not distinct from old.group_id then
    return new;
  end if;

  -- security definer: считать строки всех учеников, а не только те, что
  -- вызывающему видны по RLS.
  if exists (select 1 from public.mock_exam_task_scores s where s.mock_exam_id = old.id) then
    v_what := array_append(v_what, 'баллы');
  end if;
  if exists (select 1 from public.mock_exam_results r where r.mock_exam_id = old.id) then
    v_what := array_append(v_what, 'итоги');
  end if;
  if exists (select 1 from public.mock_exam_sheets sh where sh.mock_exam_id = old.id) then
    v_what := array_append(v_what, 'бланки');
  end if;
  if exists (select 1 from public.mock_exam_photos p where p.mock_exam_id = old.id) then
    v_what := array_append(v_what, 'фото');
  end if;
  if array_length(v_what, 1) > 0 then
    raise exception 'Группу пробника не сменить: у него уже есть % учеников прежней группы. Для другой группы заведите новый пробник.',
      array_to_string(v_what, ', ')
      using errcode = '23514';
  end if;

  if new.group_id is not null and auth.uid() is not null then
    select g.course_id into v_course from public.groups g where g.id = new.group_id;
    if not public.course_is_staff(v_course) then
      raise exception 'Нет доступа к этой группе — пробник можно перенести только в группу своего курса'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.mock_exams_group_change_guard() is
  '§228. Смена группы пробника — только пока у него нет баллов, итогов, бланков и фото (иначе 23514), и только в группу курса, где вызывающий — персонал (иначе 42501).';

revoke all on function public.mock_exams_group_change_guard() from public, anon, authenticated;

drop trigger if exists mock_exams_group_change_guard on public.mock_exams;
create trigger mock_exams_group_change_guard
  before update of group_id on public.mock_exams
  for each row execute function public.mock_exams_group_change_guard();
