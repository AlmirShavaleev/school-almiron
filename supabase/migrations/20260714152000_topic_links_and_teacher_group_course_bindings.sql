create or replace function public.prepare_topic_link_material(
  p_topic_id uuid,
  p_title text,
  p_url text
)
returns table (
  object_path text,
  normalized_title text,
  normalized_url text,
  metadata jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role public.user_role;
  v_title text;
  v_url text;
  v_topic_course_id uuid;
  v_staff_ok boolean := false;
begin
  v_title := btrim(coalesce(p_title, ''));
  v_url := btrim(coalesce(p_url, ''));

  if p_topic_id is null then
    raise exception 'TOPIC_ID_REQUIRED';
  end if;
  if v_title = '' then
    raise exception 'LINK_TITLE_REQUIRED';
  end if;
  if v_url = '' then
    raise exception 'LINK_URL_REQUIRED';
  end if;
  if v_url ~* '^//' then
    raise exception 'LINK_PROTOCOL_REQUIRED';
  end if;
  if v_url !~* '^https?://' then
    raise exception 'LINK_PROTOCOL_NOT_ALLOWED';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid();

  select m.course_id
    into v_topic_course_id
  from public.topics t
  join public.modules m on m.id = t.module_id
  where t.id = p_topic_id;

  if v_topic_course_id is null then
    raise exception 'TOPIC_NOT_FOUND';
  end if;

  if v_role in ('admin', 'owner') then
    v_staff_ok := true;
  elsif v_role in ('teacher', 'curator') then
    select exists (
      select 1
      from public.groups g
      left join public.teachers tt on tt.id = g.teacher_id
      left join public.curators cc on cc.id = g.curator_id
      where g.course_id = v_topic_course_id
        and (
          (v_role = 'teacher' and tt.profile_id = auth.uid())
          or
          (v_role = 'curator' and cc.profile_id = auth.uid())
        )
    ) into v_staff_ok;
  end if;

  if not v_staff_ok then
    raise exception 'STAFF_ONLY';
  end if;

  object_path := format('topics/%s/links/%s', p_topic_id, gen_random_uuid());
  normalized_title := v_title;
  normalized_url := v_url;
  metadata := jsonb_build_object(
    'kind', 'topic-link',
    'title', normalized_title,
    'url', normalized_url
  );

  return next;
end;
$$;

grant execute on function public.prepare_topic_link_material(uuid, text, text) to authenticated;

create policy "groups_select_teacher_owned_for_update" on public.groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teachers t
      where t.id = groups.teacher_id
        and t.profile_id = auth.uid()
    )
  );

create policy "groups_update_teacher_owned" on public.groups
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.teachers t
      where t.id = groups.teacher_id
        and t.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.teachers t
      where t.id = groups.teacher_id
        and t.profile_id = auth.uid()
    )
  );
