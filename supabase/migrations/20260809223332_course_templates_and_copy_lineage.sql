-- §113. Шаблон курса и ссылка «скопирован из».
--
-- До сих пор шаблонность жила только в слове «Шаблон» в названии, а родство
-- копии с исходником — нигде: связь была видна лишь в журнале копирования
-- (`course_copy_jobs`) и терялась для интерфейса. Список курсов из-за этого
-- показывал каркас и рабочие курсы групп одинаковыми карточками.

alter table public.courses
  add column if not exists is_template boolean not null default false,
  add column if not exists copied_from_course_id uuid references public.courses(id) on delete set null;

comment on column public.courses.is_template is
  'Курс-каркас: из него копируют курсы групп. Учеников зачисляют в копии, не в '
  'шаблон. Признак ставится галочкой в настройках курса (§113); прав он не '
  'меняет — ученику шаблоны и так не видны, он видит курсы своих групп.';

comment on column public.courses.copied_from_course_id is
  'Откуда скопирован курс. ON DELETE SET NULL: удалили шаблон — копии живут '
  'дальше, просто теряют родство (§113). Синхронизации копии с шаблоном нет и '
  'не подразумевается.';

-- Копия не может быть копией самой себя: без этого случайный self-update дал
-- бы карточку, вложенную сама в себя.
alter table public.courses
  drop constraint if exists courses_copied_from_not_self_chk;
alter table public.courses
  add constraint courses_copied_from_not_self_chk
  check (copied_from_course_id is null or copied_from_course_id <> id);

-- По этому полю список строит ряд копий под каждым шаблоном.
create index if not exists courses_copied_from_course_id_idx
  on public.courses (copied_from_course_id)
  where copied_from_course_id is not null;

-- ── Разметка существующих ────────────────────────────────────────────────────

-- Шаблоны — по id, а не по подстроке названия: названия владелец меняет.
update public.courses set is_template = true
 where id in (
   'daf8c6a3-e37f-465d-ac3e-fcadb055342a',  -- Физика ЕГЭ Шаблон
   '4b21e7c9-a0ac-4e1b-8ef3-f9ec9717fa16',  -- Математика ЕГЭ. Вторая часть — Шаблон
   'fbf65ad2-9bd1-4ff6-9f37-0a7ece103120'   -- Математика ЕГЭ. 1 часть + джентльменский набор — Шаблон
 );

-- Копии — из журнала копирования, а не по названию: там лежит настоящая связь
-- «источник → цель». Берём последнюю завершённую задачу на каждую цель.
update public.courses c
   set copied_from_course_id = src.source_course_id
  from (
    select distinct on (j.target_course_id)
           j.target_course_id, j.source_course_id
      from public.course_copy_jobs j
     where j.kind = 'course'
       and j.status = 'finalized'
       and j.target_course_id is not null
       and j.source_course_id is not null
       and j.source_course_id <> j.target_course_id
     order by j.target_course_id, j.created_at desc
  ) src
 where src.target_course_id = c.id
   and c.copied_from_course_id is null;

-- ── Копирование проставляет родство само ─────────────────────────────────────
--
-- Копия ВСЕГДА получает ссылку на исходник и никогда не рождается шаблоном:
-- шаблон — это решение человека, а не наследуемое свойство. Правка одной
-- вставки; остальное тело функции не менялось (см. §102). Значения по
-- умолчанию у параметров сохранены — без них PostgREST перестал бы звать
-- функцию так, как её зовёт клиент.
create or replace function public.course_copy_stage(
  p_source_course_id uuid,
  p_title text default null,
  p_mode text default 'clear',
  p_shift_days integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_src courses%rowtype;
  v_new_course uuid;
  v_module record;
  v_topic record;
  v_new_module uuid;
  v_new_topic uuid;
  v_files jsonb := '[]'::jsonb;
  v_job uuid;
begin
  if v_me is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;
  if p_mode not in ('clear','keep','shift') then raise exception 'Неизвестный режим дат' using errcode='check_violation'; end if;

  select * into v_src from courses where id = p_source_course_id;
  if not found then raise exception 'Курс не найден'; end if;

  -- Копировать курс целиком может владелец курса или админ платформы.
  -- Преподавателю чужого курса это не по чину: копия создаётся на него же
  -- владельцем, а значит меняет состав владельцев в школе.
  if not (public.auth_is_course_owner(p_source_course_id) or public.course_is_admin()) then
    raise exception 'Копировать курс может только его владелец' using errcode='insufficient_privilege';
  end if;

  insert into courses (
    title, subject, exam_type, description, price, duration_weeks,
    is_active, is_draft, owner_id,
    start_date, end_date, enrollment_open_until,
    is_template, copied_from_course_id
  ) values (
    coalesce(nullif(btrim(p_title), ''), v_src.title || ' (копия)'),
    v_src.subject, v_src.exam_type, v_src.description, v_src.price, v_src.duration_weeks,
    -- Черновик и неактивен: недоделанная копия не должна всплыть у учеников.
    false, true, v_me,
    public.course_copy_shift_date(v_src.start_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.end_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.enrollment_open_until, p_mode, p_shift_days),
    false, p_source_course_id
  ) returning id into v_new_course;

  for v_module in select * from modules where course_id = p_source_course_id order by order_index loop
    insert into modules (course_id, title, order_index)
    values (v_new_course, v_module.title, v_module.order_index)
    returning id into v_new_module;

    for v_topic in select * from topics where module_id = v_module.id order by order_index loop
      insert into topics (module_id, title, order_index, max_score, available_from)
      values (v_new_module, v_topic.title, v_topic.order_index, v_topic.max_score,
              public.course_copy_shift_date(v_topic.available_from, p_mode, p_shift_days))
      returning id into v_new_topic;

      v_files := v_files || public.course_copy_topic_content(v_topic.id, v_new_topic, p_mode, p_shift_days);
    end loop;
  end loop;

  insert into course_copy_jobs (requested_by, source_course_id, target_course_id, kind, files)
  values (v_me, p_source_course_id, v_new_course, 'course', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'course_id', v_new_course, 'files', v_files);
end
$$;
