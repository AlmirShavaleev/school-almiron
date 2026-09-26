-- §229. Варианты внутри пробника (условие/решение/критерии/ключ по варианту, выдача ученикам), перенос данных в вариант 1.
-- Полный текст с пояснениями — в истории ветки (PENDING_229.sql, коммит 1fe6382); здесь применённый код без комментариев.

alter table public.mock_exams
  add column if not exists variant_mode text not null default 'order'
    check (variant_mode in ('order', 'random', 'manual'));

comment on column public.mock_exams.variant_mode is
  '§229. Как раздали варианты при назначении: order — по очереди по списку, random — случайно, manual — вручную. Только для экрана.';

create table if not exists public.mock_exam_variants (
  id             uuid primary key default gen_random_uuid(),
  mock_exam_id   uuid not null references public.mock_exams(id) on delete cascade,
  position       smallint not null check (position between 1 and 30),
  label          text check (label is null or length(label) <= 60),
  condition_path text,
  solution_path  text,
  criteria_path  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (mock_exam_id, position),
  unique (id, mock_exam_id)
);

comment on table public.mock_exam_variants is
  '§229. Вариант пробника: номер, условие (обязательно для назначения — проверяет экран), решение и критерии (можно позже). Файлы — в бакете mock-exams по пути <пробник>/v<номер>/condition|solution|criteria/… Читает и пишет только персонал; ученику — через my_mock_exam / my_mock_exam_result.';
comment on column public.mock_exam_variants.criteria_path is
  '§229. Критерии оценивания (PDF). Только персоналу — ученику никогда (mock_exam_file_readable).';

create table if not exists public.mock_exam_variant_keys (
  variant_id   uuid primary key,
  mock_exam_id uuid not null,
  answers      text[] not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  foreign key (variant_id, mock_exam_id) references public.mock_exam_variants(id, mock_exam_id) on delete cascade
);

comment on table public.mock_exam_variant_keys is
  '§229. Ключ первой части варианта: answers[1] — ответ на №1. Только персоналу курса; ученику недоступен никогда (как mock_exam_answer_keys, §221).';

create index if not exists mock_exam_variant_keys_exam_idx on public.mock_exam_variant_keys (mock_exam_id);

create table if not exists public.mock_exam_variant_students (
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  variant_id   uuid not null,
  assigned_by  uuid references public.profiles(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (mock_exam_id, student_id),
  foreign key (variant_id, mock_exam_id) references public.mock_exam_variants(id, mock_exam_id) on delete cascade
);

comment on table public.mock_exam_variant_students is
  '§229. Какой вариант у ученика. Раздаёт персонал при назначении (по очереди / случайно / вручную); кому не раздали (добавлен в группу позже) — получает наименее занятый при первом заходе. Сменить можно, пока у ученика нет бланка и фото (триггер).';

create index if not exists mock_exam_variant_students_variant_idx on public.mock_exam_variant_students (variant_id);

alter table public.mock_exam_variants          enable row level security;
alter table public.mock_exam_variant_keys      enable row level security;
alter table public.mock_exam_variant_students  enable row level security;
grant select, insert, update, delete on public.mock_exam_variants         to authenticated;
grant select, insert, update, delete on public.mock_exam_variant_keys     to authenticated;
grant select, insert, update, delete on public.mock_exam_variant_students to authenticated;

drop policy if exists mock_exam_variants_staff_select on public.mock_exam_variants;
create policy mock_exam_variants_staff_select on public.mock_exam_variants
  for select to authenticated using (public.mock_exam_is_staff(mock_exam_id));
drop policy if exists mock_exam_variants_manage_insert on public.mock_exam_variants;
create policy mock_exam_variants_manage_insert on public.mock_exam_variants
  for insert to authenticated with check (public.mock_exam_can_manage(mock_exam_id));
drop policy if exists mock_exam_variants_manage_update on public.mock_exam_variants;
create policy mock_exam_variants_manage_update on public.mock_exam_variants
  for update to authenticated using (public.mock_exam_can_manage(mock_exam_id))
  with check (public.mock_exam_can_manage(mock_exam_id));
drop policy if exists mock_exam_variants_manage_delete on public.mock_exam_variants;
create policy mock_exam_variants_manage_delete on public.mock_exam_variants
  for delete to authenticated using (public.mock_exam_can_manage(mock_exam_id));

drop policy if exists mock_exam_variant_keys_staff_select on public.mock_exam_variant_keys;
create policy mock_exam_variant_keys_staff_select on public.mock_exam_variant_keys
  for select to authenticated using (public.mock_exam_is_staff(mock_exam_id));
drop policy if exists mock_exam_variant_keys_manage_insert on public.mock_exam_variant_keys;
create policy mock_exam_variant_keys_manage_insert on public.mock_exam_variant_keys
  for insert to authenticated with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());
drop policy if exists mock_exam_variant_keys_manage_update on public.mock_exam_variant_keys;
create policy mock_exam_variant_keys_manage_update on public.mock_exam_variant_keys
  for update to authenticated using (public.mock_exam_can_manage(mock_exam_id))
  with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());
drop policy if exists mock_exam_variant_keys_manage_delete on public.mock_exam_variant_keys;
create policy mock_exam_variant_keys_manage_delete on public.mock_exam_variant_keys
  for delete to authenticated using (public.mock_exam_can_manage(mock_exam_id));

drop policy if exists mock_exam_variant_students_staff_select on public.mock_exam_variant_students;
create policy mock_exam_variant_students_staff_select on public.mock_exam_variant_students
  for select to authenticated using (public.mock_exam_is_staff(mock_exam_id));
drop policy if exists mock_exam_variant_students_manage_insert on public.mock_exam_variant_students;
create policy mock_exam_variant_students_manage_insert on public.mock_exam_variant_students
  for insert to authenticated with check (public.mock_exam_can_manage(mock_exam_id));
drop policy if exists mock_exam_variant_students_manage_update on public.mock_exam_variant_students;
create policy mock_exam_variant_students_manage_update on public.mock_exam_variant_students
  for update to authenticated using (public.mock_exam_can_manage(mock_exam_id))
  with check (public.mock_exam_can_manage(mock_exam_id));
drop policy if exists mock_exam_variant_students_manage_delete on public.mock_exam_variant_students;
create policy mock_exam_variant_students_manage_delete on public.mock_exam_variant_students
  for delete to authenticated using (public.mock_exam_can_manage(mock_exam_id));

create or replace function public.mock_exam_student_variant(p_mock_exam_id uuid, p_student_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select vs.variant_id from public.mock_exam_variant_students vs
      where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id),
    (select v.id from public.mock_exam_variants v
      where v.mock_exam_id = p_mock_exam_id order by v.position limit 1));
$$;

revoke all on function public.mock_exam_student_variant(uuid, uuid) from public, anon, authenticated;

create or replace function public.mock_exam_student_has_work(p_mock_exam_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.mock_exam_sheets sh where sh.mock_exam_id = p_mock_exam_id and sh.student_id = p_student_id)
      or exists (select 1 from public.mock_exam_photos p  where p.mock_exam_id  = p_mock_exam_id and p.student_id  = p_student_id);
$$;

revoke all on function public.mock_exam_student_has_work(uuid, uuid) from public, anon, authenticated;

create or replace function public.mock_exam_ensure_variant(p_mock_exam_id uuid, p_student_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  select vs.variant_id into v_id from public.mock_exam_variant_students vs
   where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id;
  if v_id is not null then
    return v_id;
  end if;
  if not exists (select 1 from public.mock_exam_variants v where v.mock_exam_id = p_mock_exam_id) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mock_exam_variants:' || p_mock_exam_id::text, 0));
  select vs.variant_id into v_id from public.mock_exam_variant_students vs
   where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id;
  if v_id is not null then
    return v_id;
  end if;

  if public.mock_exam_student_has_work(p_mock_exam_id, p_student_id) then
    select v.id into v_id from public.mock_exam_variants v
     where v.mock_exam_id = p_mock_exam_id order by v.position limit 1;
  else
    select v.id into v_id
      from public.mock_exam_variants v
      left join lateral (
        select count(*) as n
          from public.mock_exam_variant_students vs
          join public.mock_exams me on me.id = vs.mock_exam_id
          join public.group_students gs on gs.group_id = me.group_id and gs.student_id = vs.student_id
         where vs.variant_id = v.id
      ) c on true
     where v.mock_exam_id = p_mock_exam_id
     order by c.n, (v.condition_path is null), v.position
     limit 1;
  end if;

  insert into public.mock_exam_variant_students (mock_exam_id, student_id, variant_id)
  values (p_mock_exam_id, p_student_id, v_id)
  on conflict (mock_exam_id, student_id) do nothing;
  return (select vs.variant_id from public.mock_exam_variant_students vs
           where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id);
end;
$$;

comment on function public.mock_exam_ensure_variant(uuid, uuid) is
  '§229. Выдать ученику вариант, если не выдан: наименее занятый в группе (у кого уже есть бланк/фото — первый по номеру). У пробника без вариантов — null.';

revoke all on function public.mock_exam_ensure_variant(uuid, uuid) from public, anon, authenticated;

create or replace function public.mock_exam_variant_students_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before uuid;
  v_after  uuid;
  v_exam   uuid := coalesce(new.mock_exam_id, old.mock_exam_id);
  v_stud   uuid := coalesce(new.student_id, old.student_id);
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.mock_exams me where me.id = old.mock_exam_id) then
      return old;
    end if;
    if not exists (select 1 from public.mock_exam_variants v where v.id = old.variant_id) then
      return old;  -- каскад удаления варианта: его защищает свой триггер
    end if;
    v_before := old.variant_id;
    select v.id into v_after from public.mock_exam_variants v
     where v.mock_exam_id = old.mock_exam_id order by v.position limit 1;
  else
    if tg_op = 'UPDATE' and (new.mock_exam_id, new.student_id) is distinct from (old.mock_exam_id, old.student_id) then
      raise exception 'Строка выдачи не переносится на другого ученика или пробник' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.mock_exams me
        join public.group_students gs on gs.group_id = me.group_id
       where me.id = new.mock_exam_id and gs.student_id = new.student_id
    ) then
      raise exception 'Ученик не из группы этого пробника' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      v_before := old.variant_id;
    else
      select v.id into v_before from public.mock_exam_variants v
       where v.mock_exam_id = new.mock_exam_id order by v.position limit 1;
    end if;
    v_after := new.variant_id;
  end if;

  if v_after is distinct from v_before and public.mock_exam_student_has_work(v_exam, v_stud) then
    raise exception 'Вариант не сменить: ученик уже открыл пробник — у него есть бланк или фото'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' or new.variant_id is distinct from old.variant_id then
    new.assigned_at := now();
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  end if;
  return new;
end;
$$;

revoke all on function public.mock_exam_variant_students_guard() from public, anon, authenticated;

drop trigger if exists mock_exam_variant_students_guard on public.mock_exam_variant_students;
create trigger mock_exam_variant_students_guard
  before insert or update or delete on public.mock_exam_variant_students
  for each row execute function public.mock_exam_variant_students_guard();

create or replace function public.mock_exam_variants_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.position is distinct from old.position or new.mock_exam_id is distinct from old.mock_exam_id then
      raise exception 'Номер варианта и его пробник не меняются' using errcode = '23514';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if not exists (select 1 from public.mock_exams me where me.id = old.mock_exam_id) then
    return old;
  end if;
  if exists (
    select 1
      from (select sh.student_id from public.mock_exam_sheets sh where sh.mock_exam_id = old.mock_exam_id
            union
            select p.student_id from public.mock_exam_photos p where p.mock_exam_id = old.mock_exam_id) w
     where public.mock_exam_student_variant(old.mock_exam_id, w.student_id) = old.id
  ) then
    raise exception 'Вариант не удалить: по нему уже пишут или писали ученики' using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function public.mock_exam_variants_guard() from public, anon, authenticated;

drop trigger if exists mock_exam_variants_guard on public.mock_exam_variants;
create trigger mock_exam_variants_guard
  before update or delete on public.mock_exam_variants
  for each row execute function public.mock_exam_variants_guard();

create or replace function public.mock_exam_sheets_assign_variant()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mock_exam_ensure_variant(new.mock_exam_id, new.student_id);
  return new;
end;
$$;

revoke all on function public.mock_exam_sheets_assign_variant() from public, anon, authenticated;

drop trigger if exists mock_exam_sheets_assign_variant on public.mock_exam_sheets;
create trigger mock_exam_sheets_assign_variant
  before insert on public.mock_exam_sheets
  for each row execute function public.mock_exam_sheets_assign_variant();

create or replace function public.mock_exam_variants_group_changed()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.group_id is distinct from old.group_id then
    delete from public.mock_exam_variant_students vs
     where vs.mock_exam_id = new.id
       and not exists (select 1 from public.group_students gs
                        where gs.group_id = new.group_id and gs.student_id = vs.student_id);
  end if;
  return null;
end;
$$;

revoke all on function public.mock_exam_variants_group_changed() from public, anon, authenticated;

drop trigger if exists mock_exam_variants_group_changed on public.mock_exams;
create trigger mock_exam_variants_group_changed
  after update of group_id on public.mock_exams
  for each row execute function public.mock_exam_variants_group_changed();

create or replace function public.mock_exams_legacy_files_to_variant()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.condition_path is distinct from old.condition_path then
    update public.mock_exam_variants set condition_path = new.condition_path
     where mock_exam_id = new.id and position = 1;
  end if;
  if new.solution_path is distinct from old.solution_path then
    update public.mock_exam_variants set solution_path = new.solution_path
     where mock_exam_id = new.id and position = 1;
  end if;
  return null;
end;
$$;

revoke all on function public.mock_exams_legacy_files_to_variant() from public, anon, authenticated;

drop trigger if exists mock_exams_legacy_files_to_variant on public.mock_exams;
create trigger mock_exams_legacy_files_to_variant
  after update of condition_path, solution_path on public.mock_exams
  for each row execute function public.mock_exams_legacy_files_to_variant();

insert into public.mock_exam_variants (mock_exam_id, position, condition_path, solution_path)
select me.id, 1, me.condition_path, me.solution_path
  from public.mock_exams me
 where not exists (select 1 from public.mock_exam_variants v where v.mock_exam_id = me.id);

insert into public.mock_exam_variant_keys (variant_id, mock_exam_id, answers, updated_by, updated_at)
select v.id, v.mock_exam_id, k.answers, k.updated_by, k.updated_at
  from public.mock_exam_answer_keys k
  join public.mock_exam_variants v on v.mock_exam_id = k.mock_exam_id and v.position = 1
on conflict (variant_id) do nothing;

insert into public.mock_exam_variant_students (mock_exam_id, student_id, variant_id)
select me.id, gs.student_id, v.id
  from public.mock_exams me
  join public.group_students gs on gs.group_id = me.group_id
  join public.mock_exam_variants v on v.mock_exam_id = me.id and v.position = 1
 where not exists (select 1 from public.mock_exam_variants v2 where v2.mock_exam_id = me.id and v2.position > 1)
on conflict (mock_exam_id, student_id) do nothing;

create or replace function public.mock_exam_answer_keys_to_variant()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.mock_exam_variant_keys (variant_id, mock_exam_id, answers, updated_by, updated_at)
  select v.id, v.mock_exam_id, new.answers, new.updated_by, new.updated_at
    from public.mock_exam_variants v
   where v.mock_exam_id = new.mock_exam_id and v.position = 1
  on conflict (variant_id) do update
    set answers = excluded.answers, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return null;
end;
$$;

revoke all on function public.mock_exam_answer_keys_to_variant() from public, anon, authenticated;

drop trigger if exists mock_exam_answer_keys_to_variant on public.mock_exam_answer_keys;
create trigger mock_exam_answer_keys_to_variant
  after insert or update on public.mock_exam_answer_keys
  for each row execute function public.mock_exam_answer_keys_to_variant();

create or replace function public.save_mock_exam_variant_key(p_variant_id uuid, p_answers text[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam  uuid;
  v_pos   int;
  v_part1 int;
  v_clean text[];
  v_bad   int[];
  v_grade jsonb;
begin
  select v.mock_exam_id, v.position into v_exam, v_pos
    from public.mock_exam_variants v where v.id = p_variant_id;
  if v_exam is null or not public.mock_exam_can_manage(v_exam) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  if v_pos = 1 then
    return public.save_mock_exam_key(v_exam, p_answers);
  end if;
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = v_exam;
  if v_part1 is null then
    raise exception 'У пробника нет шаблона — неизвестно, сколько ответов в ключе' using errcode = '22023';
  end if;
  if coalesce(array_length(p_answers, 1), 0) <> v_part1 then
    raise exception 'В ключе должно быть ровно % ответов (первая часть)', v_part1 using errcode = '22023';
  end if;
  select array_agg(nullif(btrim(coalesce(a, '')), '') order by i) into v_clean
    from unnest(p_answers) with ordinality x(a, i);
  if exists (select 1 from unnest(v_clean) a where length(a) > 40) then
    raise exception 'Ответ ключа длиннее 40 знаков' using errcode = '22023';
  end if;

  insert into public.mock_exam_variant_keys (variant_id, mock_exam_id, answers, updated_by, updated_at)
  values (p_variant_id, v_exam, v_clean, auth.uid(), now())
  on conflict (variant_id) do update
    set answers = excluded.answers, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  select coalesce(array_agg(i::int order by i), '{}') into v_bad
    from unnest(v_clean) with ordinality x(a, i)
   where a is not null
     and public.variant_answer_verdict(public.normalize_variant_answer(a), public.normalize_variant_answer(a)) is null;

  v_grade := public.grade_mock_exam_part1(v_exam);
  return jsonb_build_object('not_checkable', to_jsonb(v_bad), 'grade', v_grade);
end;
$$;

comment on function public.save_mock_exam_variant_key(uuid, text[]) is
  '§229. Сохранить ключ первой части варианта и перепроверить законченные бланки. Вариант 1 — через save_mock_exam_key.';

revoke all on function public.save_mock_exam_variant_key(uuid, text[]) from public, anon;
grant execute on function public.save_mock_exam_variant_key(uuid, text[]) to authenticated;

create or replace function public.grade_mock_exam_part1(p_mock_exam_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam     record;
  v_ends_at  timestamptz;
  v_key      text[];
  v_n        int;
  v_sheet    record;
  v_cur_p    smallint[];
  v_cur_a    smallint[];
  v_pts      jsonb;
  v_auto     jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_autos    jsonb := '[]'::jsonb;
  v_changed  boolean;
  v_verdict  boolean;
  v_a        int;
  v_p        int;
  v_students int := 0;
  v_cells    int := 0;
  i          int;
  x          jsonb;
  v_has_var  boolean;
  v_first    uuid;
  v_skey     text[];
begin
  if not public.mock_exam_can_manage(p_mock_exam_id) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  select me.group_id, me.starts_at, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found or v_exam.starts_at is null then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_window');
  end if;
  select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;
  select v.id into v_first from public.mock_exam_variants v
   where v.mock_exam_id = p_mock_exam_id order by v.position limit 1;
  v_has_var := v_first is not null;
  if (v_has_var and not exists (select 1 from public.mock_exam_variant_keys vk where vk.mock_exam_id = p_mock_exam_id))
     or (not v_has_var and v_key is null) then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_key');
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  v_n := array_length(v_exam.max_points, 1);

  perform pg_advisory_xact_lock(hashtextextended('save_mock_exam_grid:' || p_mock_exam_id::text, 0));

  for v_sheet in
    select sh.student_id, sh.answers,
           case when v_has_var then
             (select vk.answers from public.mock_exam_variant_keys vk
               where vk.variant_id = coalesce(
                       (select vs.variant_id from public.mock_exam_variant_students vs
                         where vs.mock_exam_id = p_mock_exam_id and vs.student_id = sh.student_id),
                       v_first))
           else v_key end as key_answers
      from public.mock_exam_sheets sh
      join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = sh.student_id
     where sh.mock_exam_id = p_mock_exam_id
       and (sh.submitted_at is not null
            or (now() >= v_ends_at
                and (exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
                     or exists (select 1 from public.mock_exam_photos ph
                                 where ph.mock_exam_id = p_mock_exam_id and ph.student_id = sh.student_id))))
     order by sh.student_id
  loop
    v_skey := v_sheet.key_answers;
    if v_skey is null then
      continue;  -- §229: у варианта ученика ключа нет — первую часть ставит преподаватель
    end if;
    v_cur_p := array_fill(null::smallint, array[v_n]);
    v_cur_a := array_fill(null::smallint, array[v_n]);
    for x in
      select jsonb_build_object('t', sc.task_number, 'p', sc.points, 'a', sc.auto_points)
        from public.mock_exam_task_scores sc
       where sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_sheet.student_id
         and sc.task_number between 1 and v_n
    loop
      v_cur_p[(x->>'t')::int] := (x->>'p')::smallint;
      v_cur_a[(x->>'t')::int] := (x->>'a')::smallint;
    end loop;

    v_pts := '[]'::jsonb;
    v_auto := '[]'::jsonb;
    v_changed := false;
    for i in 1..v_n loop
      v_p := v_cur_p[i];
      if i <= v_exam.part1_last and nullif(btrim(coalesce(v_skey[i], '')), '') is not null then
        v_verdict := public.variant_answer_verdict(
          public.normalize_variant_answer(v_skey[i]),
          public.normalize_variant_answer(coalesce(v_sheet.answers[i], '')));
        if v_verdict is not null and (v_cur_p[i] is null or v_cur_p[i] = v_cur_a[i]) then
          v_a := case when v_verdict then v_exam.max_points[i] else 0 end;
          if v_cur_p[i] is distinct from v_a or v_cur_a[i] is distinct from v_a then
            v_changed := true;
            v_cells := v_cells + 1;
          end if;
          v_p := v_a;
          v_auto := v_auto || jsonb_build_array(jsonb_build_object('t', i, 'a', v_a));
        end if;
      end if;
      v_pts := v_pts || jsonb_build_array(to_jsonb(v_p));
    end loop;

    v_students := v_students + 1;
    if v_changed then
      v_rows  := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'points', v_pts));
      v_autos := v_autos || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'cells', v_auto));
    end if;
  end loop;

  if jsonb_array_length(v_rows) > 0 then
    perform public.save_mock_exam_grid(p_mock_exam_id, v_rows);
    update public.mock_exam_task_scores sc
       set auto_points = (c->>'a')::smallint,
           updated_by  = auth.uid()
      from jsonb_array_elements(v_autos) s,
           jsonb_array_elements(s->'cells') c
     where sc.mock_exam_id = p_mock_exam_id
       and sc.student_id   = (s->>'student_id')::uuid
       and sc.task_number  = (c->>'t')::int
       and sc.auto_points is distinct from (c->>'a')::smallint;
  end if;

  return jsonb_build_object('graded_students', v_students, 'changed_cells', v_cells);
end;
$$;

comment on function public.grade_mock_exam_part1(uuid) is
  '§221, §224, §229. Проверить первую часть законченных бланков по ключу ВАРИАНТА ученика (normalize_variant_answer + variant_answer_verdict) и записать в таблицу §218 через save_mock_exam_grid. Трогает только пустые и «авто»-клетки. Бланк без единого ответа и фото, не сданный, не проверяет (§224). Пробник без вариантов — прежний ключ mock_exam_answer_keys. Под правами вызывающего.';

revoke all on function public.grade_mock_exam_part1(uuid) from public, anon;
grant execute on function public.grade_mock_exam_part1(uuid) to authenticated;

create or replace function public.my_mock_exam(p_mock_exam_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_exam    record;
  v_w       record;
  v_sheet   public.mock_exam_sheets;
  v_started boolean;
  v_var     public.mock_exam_variants;
  v_var_id  uuid;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select me.id, me.title, me.group_id, me.module_id, me.condition_path, me.solution_path,
         t.max_points, t.part1_last, t.title as template_title
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  select * into v_sheet from public.mock_exam_sheets
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  v_started := v_w.starts_at is not null and now() >= v_w.starts_at;
  v_var_id := public.mock_exam_ensure_variant(p_mock_exam_id, v_student);
  if v_var_id is not null then
    select * into v_var from public.mock_exam_variants where id = v_var_id;
  end if;

  return jsonb_build_object(
    'id',             v_exam.id,
    'title',          v_exam.title,
    'group_id',       v_exam.group_id,
    'student_id',     v_student,
    'template_title', v_exam.template_title,
    'task_count',     coalesce(array_length(v_exam.max_points, 1), 0),
    'part1_last',     v_exam.part1_last,
    'part2_max',      (select coalesce(jsonb_agg(m order by i), '[]'::jsonb)
                         from unnest(v_exam.max_points) with ordinality x(m, i)
                        where i > v_exam.part1_last),
    'starts_at',      v_w.starts_at,
    'ends_at',        v_w.ends_at,
    'photos_until',   v_w.photos_until,
    'server_now',     now(),
    'condition_path', case when v_started then
                        case when v_var_id is not null then v_var.condition_path else v_exam.condition_path end
                      end,
    'variant',        case when v_var_id is not null then
                        jsonb_build_object('position', v_var.position, 'label', v_var.label)
                      end,
    'variant_count',  (select count(*) from public.mock_exam_variants v where v.mock_exam_id = p_mock_exam_id),
    'answers',        case when v_sheet.student_id is not null then to_jsonb(v_sheet.answers) else '[]'::jsonb end,
    'submitted_at',   v_sheet.submitted_at,
    'updated_at',     v_sheet.updated_at,
    'notified',       now() >= v_w.ends_at and exists (select 1 from public.mock_exam_results r
                               where r.mock_exam_id = p_mock_exam_id and r.student_id = v_student
                                 and r.notified_at is not null),
    'photos',         (select coalesce(jsonb_agg(jsonb_build_object(
                                 'id', p.id, 'storage_path', p.storage_path, 'file_name', p.file_name,
                                 'mime_type', p.mime_type, 'size_bytes', p.size_bytes,
                                 'position', p.position, 'created_at', p.created_at)
                               order by p.position, p.created_at), '[]'::jsonb)
                         from public.mock_exam_photos p
                        where p.mock_exam_id = p_mock_exam_id and p.student_id = v_student)
  );
end;
$$;

revoke all on function public.my_mock_exam(uuid) from public, anon;
grant execute on function public.my_mock_exam(uuid) to authenticated;

create or replace function public.my_mock_exam_result(p_mock_exam_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_r       public.mock_exam_results;
  v_exam    record;
  v_sheet   public.mock_exam_sheets;
  v_key     text[];
  v_w       record;
  v_var     public.mock_exam_variants;
  v_var_id  uuid;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select * into v_r from public.mock_exam_results
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  if not found or v_r.notified_at is null then
    return jsonb_build_object('status', 'pending');
  end if;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  if v_w.ends_at is not null and now() < v_w.ends_at then
    return jsonb_build_object('status', 'pending');
  end if;

  select me.title, me.max_score, me.solution_path, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_sheet from public.mock_exam_sheets
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  v_var_id := public.mock_exam_student_variant(p_mock_exam_id, v_student);
  if v_var_id is not null then
    select * into v_var from public.mock_exam_variants where id = v_var_id;
    select vk.answers into v_key from public.mock_exam_variant_keys vk where vk.variant_id = v_var_id;
  else
    select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;
  end if;

  return jsonb_build_object(
    'status',        'ready',
    'title',         v_exam.title,
    'notified_at',   v_r.notified_at,
    'score',         v_r.score,
    'max_score',     v_exam.max_score,
    'primary_score', v_r.primary_score,
    'part1_score',   v_r.part1_score,
    'part2_score',   v_r.part2_score,
    'part1_last',    v_exam.part1_last,
    'solution_path', case when v_var_id is not null then v_var.solution_path else v_exam.solution_path end,
    'variant',       case when v_var_id is not null then
                       jsonb_build_object('position', v_var.position, 'label', v_var.label)
                     end,
    'tasks',         (select coalesce(jsonb_agg(jsonb_build_object(
                               'n',       i,
                               'max',     m,
                               'points',  sc.points,
                               'answer',  case when i <= v_exam.part1_last then v_sheet.answers[i] end,
                               'correct', case when i <= v_exam.part1_last then v_key[i] end)
                             order by i), '[]'::jsonb)
                        from unnest(v_exam.max_points) with ordinality x(m, i)
                        left join public.mock_exam_task_scores sc
                          on sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_student and sc.task_number = i)
  );
end;
$$;

revoke all on function public.my_mock_exam_result(uuid) from public, anon;
grant execute on function public.my_mock_exam_result(uuid) to authenticated;

create or replace function public.mock_exam_file_readable(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_exam  uuid;
  v_me    uuid;
  v_w     record;
  v_kind  text;
  v_pos   int;
  v_mine  int;
begin
  if coalesce(array_length(v_parts, 1), 0) < 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_exam := v_parts[1]::uuid;
  if public.mock_exam_is_staff(v_exam) then
    return true;
  end if;
  v_me := public.mock_exam_my_student_id(v_exam);
  if v_me is null then
    return false;
  end if;
  if v_parts[2] = 'photos' then
    return array_length(v_parts, 1) >= 4 and v_parts[3] = v_me::text;
  end if;
  if v_parts[2] in ('condition', 'solution') then
    v_kind := v_parts[2];
    v_pos  := 1;
  elsif v_parts[2] ~ '^v[0-9]{1,3}$' and array_length(v_parts, 1) >= 4 then
    v_kind := v_parts[3];
    v_pos  := substr(v_parts[2], 2)::int;
  else
    return false;
  end if;
  if v_kind not in ('condition', 'solution') then
    return false;
  end if;
  select v.position into v_mine
    from public.mock_exam_variants v
   where v.id = public.mock_exam_student_variant(v_exam, v_me);
  if coalesce(v_mine, 1) <> v_pos then
    return false;
  end if;
  select * into v_w from public.mock_exam_window(v_exam);
  if v_kind = 'condition' then
    return v_w.starts_at is not null and now() >= v_w.starts_at;
  elsif v_kind = 'solution' then
    return v_w.ends_at is not null and now() >= v_w.ends_at
       and exists (select 1 from public.mock_exam_results r
                    where r.mock_exam_id = v_exam and r.student_id = v_me and r.notified_at is not null);
  end if;
  return false;
end;
$$;

create or replace function public.mock_exam_file_writable(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_exam  uuid;
  v_me    uuid;
  v_w     record;
begin
  if coalesce(array_length(v_parts, 1), 0) < 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_exam := v_parts[1]::uuid;
  if v_parts[2] in ('condition', 'solution') then
    return public.mock_exam_can_manage(v_exam);
  elsif v_parts[2] ~ '^v[0-9]{1,3}$' then
    return array_length(v_parts, 1) >= 4
       and v_parts[3] in ('condition', 'solution', 'criteria')
       and public.mock_exam_can_manage(v_exam);
  elsif v_parts[2] = 'photos' then
    v_me := public.mock_exam_my_student_id(v_exam);
    if v_me is null or array_length(v_parts, 1) < 4 or v_parts[3] <> v_me::text then
      return false;
    end if;
    select * into v_w from public.mock_exam_window(v_exam);
    return v_w.starts_at is not null and now() >= v_w.starts_at and now() < v_w.photos_until;
  end if;
  return false;
end;
$$;

revoke all on function public.mock_exam_file_readable(text) from public, anon;
revoke all on function public.mock_exam_file_writable(text) from public, anon;
grant execute on function public.mock_exam_file_readable(text) to authenticated;
grant execute on function public.mock_exam_file_writable(text) to authenticated;
