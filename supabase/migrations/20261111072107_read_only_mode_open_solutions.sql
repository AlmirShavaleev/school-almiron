-- Временный режим «только просмотр» (авария self-hosted, ноябрь 2026).
-- Пока флаг read_only_mode включён, авторские решения ДЗ и критерии открыты
-- всем ученикам на видимых им темах: сдать ДЗ нельзя, пусть проверяют себя сами.
-- Выключить: update public.app_feature_flags set enabled = false where key = 'read_only_mode';
insert into public.app_feature_flags(key, enabled, note)
values ('read_only_mode', true, 'Авария self-hosted, ноябрь 2026: сдача закрыта, решения ДЗ открыты всем ученикам')
on conflict (key) do update set enabled = excluded.enabled, note = excluded.note, updated_at = now();

create or replace function public.topic_solution_unlocked(p_topic_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    exists (
      select 1 from app_feature_flags f where f.key = 'read_only_mode' and f.enabled
    )
    or not exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    )
    or exists (
      select 1
        from topic_homework_attempts a
        join topic_homework h on h.id = a.homework_id
       where h.topic_id = p_topic_id
         and a.student_id = public.auth_student_id()
         and a.status = 'accepted'
    );
$function$;
