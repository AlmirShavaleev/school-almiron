-- §268: RLS каталога — функции в (select …), чтобы считались один раз на запрос, а не на каждую строку.
-- Смысл политик не меняется. Замер (ученик, count по 9 515 задачам): 269 мс → 13 мс.
alter policy catalog_tasks_all_admin on public.catalog_tasks using ((select public.is_admin_or_owner()));
alter policy catalog_tasks_select_auth on public.catalog_tasks using (((select auth.uid()) is not null) and is_published = true);
alter policy catalog_tasks_select_teacher on public.catalog_tasks using (((select public.get_my_role()) = any (array['teacher'::user_role,'curator'::user_role])) and is_published = true);

alter policy catalog_sections_all_admin on public.catalog_sections using ((select public.is_admin_or_owner()));
alter policy catalog_sections_select_auth on public.catalog_sections using (((select auth.uid()) is not null) and is_published = true);
alter policy catalog_sections_select_teacher on public.catalog_sections using (((select public.get_my_role()) = any (array['teacher'::user_role,'curator'::user_role])) and is_published = true);

alter policy catalog_topics_all_admin on public.catalog_topics using ((select public.is_admin_or_owner()));
alter policy catalog_topics_select_auth on public.catalog_topics using (((select auth.uid()) is not null) and is_published = true);
alter policy catalog_topics_select_teacher on public.catalog_topics using (((select public.get_my_role()) = any (array['teacher'::user_role,'curator'::user_role])) and is_published = true);

alter policy catalog_task_assets_all_admin on public.catalog_task_assets using ((select public.is_admin_or_owner()));
alter policy catalog_task_assets_select_auth on public.catalog_task_assets using (((select auth.uid()) is not null) and exists (select 1 from public.catalog_tasks t where t.id = catalog_task_assets.task_id and t.is_published = true));

alter policy catalog_task_topics_all_admin on public.catalog_task_topics using ((select public.is_admin_or_owner()));
alter policy catalog_task_topics_select_auth on public.catalog_task_topics using (((select auth.uid()) is not null) and exists (select 1 from public.catalog_tasks t where t.id = catalog_task_topics.task_id and t.is_published = true));

alter policy catalog_progress_select_admin on public.catalog_task_progress using ((select public.is_admin_or_owner()));
alter policy catalog_progress_select_own on public.catalog_task_progress using (user_id = (select auth.uid()));
alter policy catalog_progress_update_own on public.catalog_task_progress using (user_id = (select auth.uid()));
alter policy catalog_progress_delete_own on public.catalog_task_progress using (user_id = (select auth.uid()));
alter policy catalog_progress_insert_own on public.catalog_task_progress with check (user_id = (select auth.uid()));
