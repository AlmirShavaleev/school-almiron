-- Триггеры: правка каркаса уезжает в классы сама (§172).
--
-- Кнопки «синхронизировать» нет по решению владельца — «все изменения в
-- каркасе автоматически подтягиваются в курсы». Значит, точка входа одна:
-- обычная правка шаблона, какой бы экран её ни делал.
--
-- Удаление всегда обрабатывается BEFORE DELETE. Причина простая: у линейки
-- `on delete set null`, и AFTER DELETE застал бы отражения уже без связи —
-- сиротами, которых потом никто не опознает.

-- Расхождение переживает удаление темы каркаса: именно она и могла его
-- породить («тему убрали, а в классе по ней работали»).
alter table public.template_sync_issues
  alter column template_topic_id drop not null;

alter table public.template_sync_issues
  drop constraint if exists template_sync_issues_template_topic_id_fkey;

alter table public.template_sync_issues
  add constraint template_sync_issues_template_topic_id_fkey
  foreign key (template_topic_id) references public.topics(id) on delete set null;

drop policy if exists template_sync_issues_read on public.template_sync_issues;
create policy template_sync_issues_read on public.template_sync_issues
  for select to authenticated
  using (
    (template_topic_id is not null and public.topic_material_can_manage(template_topic_id))
    or public.topic_material_can_manage(copy_topic_id)
  );

-- ── Материалы ───────────────────────────────────────────────────────────────

create or replace function public.trg_template_sync_material()
returns trigger language plpgsql security definer set search_path to ''
as $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.topic_is_in_template(OLD.topic_id) THEN
      DELETE FROM public.topic_material_items WHERE source_item_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF public.topic_is_in_template(NEW.topic_id) THEN
    PERFORM public.template_sync_topic_apply(NEW.topic_id);
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists template_sync_material_write  on public.topic_material_items;
drop trigger if exists template_sync_material_delete on public.topic_material_items;

create trigger template_sync_material_write
  after insert or update on public.topic_material_items
  for each row execute function public.trg_template_sync_material();

create trigger template_sync_material_delete
  before delete on public.topic_material_items
  for each row execute function public.trg_template_sync_material();

-- ── Домашнее задание и его файлы ────────────────────────────────────────────

create or replace function public.trg_template_sync_homework()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_copy record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.topic_is_in_template(OLD.topic_id) THEN
      FOR v_copy IN
        SELECT ch.id, ch.topic_id FROM public.topic_homework ch WHERE ch.source_homework_id = OLD.id
      LOOP
        IF EXISTS (SELECT 1 FROM public.topic_homework_attempts a WHERE a.homework_id = v_copy.id) THEN
          INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
          VALUES (OLD.topic_id, v_copy.topic_id, 'delete_kept',
                  'ДЗ убрано в каркасе, но по нему есть работы учеников — осталось в классе');
        ELSE
          DELETE FROM public.topic_homework WHERE id = v_copy.id;
        END IF;
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  IF public.topic_is_in_template(NEW.topic_id) THEN
    PERFORM public.template_sync_topic_apply(NEW.topic_id);
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists template_sync_homework_write  on public.topic_homework;
drop trigger if exists template_sync_homework_delete on public.topic_homework;

create trigger template_sync_homework_write
  after insert or update on public.topic_homework
  for each row execute function public.trg_template_sync_homework();

create trigger template_sync_homework_delete
  before delete on public.topic_homework
  for each row execute function public.trg_template_sync_homework();

create or replace function public.trg_template_sync_homework_file()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_topic uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT topic_id INTO v_topic FROM public.topic_homework WHERE id = OLD.homework_id;
    IF v_topic IS NOT NULL AND public.topic_is_in_template(v_topic) THEN
      DELETE FROM public.topic_homework_files WHERE source_file_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  SELECT topic_id INTO v_topic FROM public.topic_homework WHERE id = NEW.homework_id;
  IF v_topic IS NOT NULL AND public.topic_is_in_template(v_topic) THEN
    PERFORM public.template_sync_topic_apply(v_topic);
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists template_sync_homework_file_write  on public.topic_homework_files;
drop trigger if exists template_sync_homework_file_delete on public.topic_homework_files;

create trigger template_sync_homework_file_write
  after insert or update on public.topic_homework_files
  for each row execute function public.trg_template_sync_homework_file();

create trigger template_sync_homework_file_delete
  before delete on public.topic_homework_files
  for each row execute function public.trg_template_sync_homework_file();

-- ── Задачи к уроку ──────────────────────────────────────────────────────────
--
-- Своей линейки у набора нет и не нужно: у темы он один (§164), связь идёт
-- через тему, а строки сопоставляются по `task_id`. Здесь достаточно позвать
-- синхронизацию темы — она пересоберёт набор копии по набору каркаса.

create or replace function public.trg_template_sync_variant()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_topic uuid;
BEGIN
  v_topic := coalesce(NEW.topic_id, OLD.topic_id);
  IF v_topic IS NOT NULL AND public.topic_is_in_template(v_topic) THEN
    PERFORM public.template_sync_topic_apply(v_topic);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

drop trigger if exists template_sync_variant on public.test_variants;
create trigger template_sync_variant
  after insert or update or delete on public.test_variants
  for each row execute function public.trg_template_sync_variant();

create or replace function public.trg_template_sync_variant_item()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_topic uuid;
BEGIN
  SELECT v.topic_id INTO v_topic FROM public.test_variants v
   WHERE v.id = coalesce(NEW.variant_id, OLD.variant_id);

  IF v_topic IS NOT NULL AND public.topic_is_in_template(v_topic) THEN
    PERFORM public.template_sync_topic_apply(v_topic);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

drop trigger if exists template_sync_variant_item on public.test_variant_items;
create trigger template_sync_variant_item
  after insert or update or delete on public.test_variant_items
  for each row execute function public.trg_template_sync_variant_item();

-- ── Темы ────────────────────────────────────────────────────────────────────

create or replace function public.trg_template_sync_topic()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_copy record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.topic_is_in_template(OLD.id) THEN
      FOR v_copy IN SELECT ct.id, ct.module_id FROM public.topics ct WHERE ct.source_topic_id = OLD.id
      LOOP
        -- Тема, по которой ученики уже работали, вслед за каркасом не исчезает:
        -- это чужая работа, и убрать её — решение преподавателя.
        IF public.topic_has_student_traces(v_copy.id) THEN
          INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
          VALUES (NULL, v_copy.id, 'delete_kept',
                  'Тема убрана в каркасе, но по ней есть работа учеников — осталась в классе');
        ELSE
          DELETE FROM public.topics WHERE id = v_copy.id;
          PERFORM public.template_renumber_topics(v_copy.module_id);
        END IF;
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  -- Новая тема в каркасе появляется во всех копиях модуля; переименование и
  -- перестановка — тем же путём, модуль пересчитает порядок.
  IF public.topic_is_in_template(NEW.id) THEN
    PERFORM public.template_sync_module_apply(NEW.module_id);
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists template_sync_topic_write  on public.topics;
drop trigger if exists template_sync_topic_delete on public.topics;

create trigger template_sync_topic_write
  after insert or update of title, order_index, max_score, module_id on public.topics
  for each row execute function public.trg_template_sync_topic();

create trigger template_sync_topic_delete
  before delete on public.topics
  for each row execute function public.trg_template_sync_topic();

-- ── Модули ──────────────────────────────────────────────────────────────────

create or replace function public.trg_template_sync_module()
returns trigger language plpgsql security definer set search_path to ''
as $function$
DECLARE
  v_copy  record;
  v_topic record;
  v_left  integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.courses c WHERE c.id = OLD.course_id AND c.is_template) THEN
      FOR v_copy IN SELECT cm.id, cm.course_id FROM public.modules cm WHERE cm.source_module_id = OLD.id
      LOOP
        FOR v_topic IN SELECT ct.id FROM public.topics ct WHERE ct.module_id = v_copy.id
        LOOP
          IF public.topic_has_student_traces(v_topic.id) THEN
            INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
            VALUES (NULL, v_topic.id, 'delete_kept',
                    'Модуль убран в каркасе, но по теме есть работа учеников — осталась в классе');
          ELSE
            DELETE FROM public.topics WHERE id = v_topic.id;
          END IF;
        END LOOP;

        SELECT count(*) INTO v_left FROM public.topics WHERE module_id = v_copy.id;
        IF v_left = 0 THEN
          DELETE FROM public.modules WHERE id = v_copy.id;
        END IF;
        PERFORM public.template_renumber_modules(v_copy.course_id);
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1 FROM public.courses c WHERE c.id = NEW.course_id AND c.is_template) THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.template_sync_course_apply(NEW.course_id);
    ELSE
      PERFORM public.template_sync_module_apply(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

drop trigger if exists template_sync_module_write  on public.modules;
drop trigger if exists template_sync_module_delete on public.modules;

create trigger template_sync_module_write
  after insert or update of title, order_index on public.modules
  for each row execute function public.trg_template_sync_module();

create trigger template_sync_module_delete
  before delete on public.modules
  for each row execute function public.trg_template_sync_module();
