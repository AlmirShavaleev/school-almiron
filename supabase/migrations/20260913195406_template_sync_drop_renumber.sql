-- Пересчёт порядка убран целиком (§172).
--
-- Замер на проде: в каркасе математики номера модулей идут с пропусками —
-- 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 15, 16, 20, — потому что они повторяют
-- номера заданий ЕГЭ («№8 Производная», «№13»). Любой «пересчёт целых»
-- схлопывает их в плотный ряд и стирает смысл нумерации: сухой прогон догона
-- переписал бы 44 модуля в живых классах, не добавив ничего.
--
-- Поэтому порядок больше не пересчитывается вовсе. Связанные строки получают
-- `order_index` каркаса — этого достаточно; своё в классе сохраняет свой номер.
-- Совпадение номеров разрешает та же сортировка, что в клиенте
-- (`order_index`, затем `created_at`): своё в классе заводят позже
-- скопированного, значит оно и встаёт следом. Без единой записи в базу.
--
-- Это отступление от вводной («order_index + 0.5 → пересчёт целых») — с
-- цифрой, из-за которой оно сделано.

drop function if exists public.template_renumber_topics(uuid);
drop function if exists public.template_renumber_modules(uuid);

create or replace function public.template_sync_module_apply(p_template_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl    record;
  v_copy   record;
  v_topic  record;
  v_new    uuid;
  v_topics integer := 0;
BEGIN
  SELECT m.id, m.title, m.order_index, m.course_id INTO v_tpl
    FROM public.modules m WHERE m.id = p_template_module_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('copies', 0); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v_tpl.course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  FOR v_copy IN
    SELECT cm.id, cm.course_id FROM public.modules cm WHERE cm.source_module_id = p_template_module_id
  LOOP
    UPDATE public.modules
       SET title = v_tpl.title, order_index = v_tpl.order_index
     WHERE id = v_copy.id
       AND (title, order_index) IS DISTINCT FROM (v_tpl.title, v_tpl.order_index);

    FOR v_topic IN
      SELECT t.id, t.title, t.order_index, t.max_score, t.is_open
        FROM public.topics t WHERE t.module_id = p_template_module_id ORDER BY t.order_index
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.topics ct
                      WHERE ct.module_id = v_copy.id AND ct.source_topic_id = v_topic.id) THEN
        -- Правило копирования из §101: nullif(is_open, true). Дата открытия не
        -- переносится вовсе — она про расписание класса.
        INSERT INTO public.topics (module_id, title, order_index, max_score, is_open, available_from, source_topic_id)
        VALUES (v_copy.id, v_topic.title, v_topic.order_index, v_topic.max_score,
                nullif(v_topic.is_open, true), NULL, v_topic.id)
        RETURNING id INTO v_new;
        v_topics := v_topics + 1;
      END IF;

      PERFORM public.template_sync_topic_apply(v_topic.id);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('topics_created', v_topics);
END;
$function$;

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
        END IF;
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  IF public.topic_is_in_template(NEW.id) THEN
    PERFORM public.template_sync_module_apply(NEW.module_id);
  END IF;
  RETURN NEW;
END;
$function$;

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
