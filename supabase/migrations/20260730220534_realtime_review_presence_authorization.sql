-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730220534
--   name    = realtime_review_presence_authorization
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- Присутствие в проверке ДЗ: авторизация приватных каналов Realtime
-- ============================================================
-- Задача владельца: показывать в реальном времени, что работу сейчас
-- кто-то смотрит («Смотрит: Имя»), и мягко защищать от одновременного
-- редактирования пометок.
--
-- Механизм — Supabase Presence. Канал на КУРС: 'hw-review:<course_id>'.
-- Почему на курс, а не на попытку: очередь показывает десятки работ сразу,
-- и канал-на-попытку означал бы десятки подписок с одной вкладки. В payload
-- присутствия участник кладёт attempt_id — этого хватает, чтобы понять, кто
-- в какой работе, при одной подписке на курс.
--
-- Канал ПРИВАТНЫЙ (config.private = true). Публичный канал читается и
-- пишется любым, у кого есть anon-ключ, — а он лежит в бандле. Тогда
-- посторонний мог бы и собрать имена преподавателей, и наоборот —
-- подделать присутствие, чтобы все работы выглядели «занятыми».
-- Приватный канал проверяется политиками на realtime.messages.
--
-- realtime.messages: RLS включён, политик до сих пор не было ни одной —
-- то есть все приватные каналы были закрыты. Эти две политики открывают
-- ровно топики вида 'hw-review:<uuid>' и ровно персоналу курса.
-- Другие приватные каналы (если появятся) остаются закрытыми.
--
-- Права считает та же public.course_is_staff — по правилу из CLAUDE.md:
-- любую проверку «персонал ли по курсу» вести через неё, а не переписывать
-- условия руками. Здесь это особенно важно: канал должен видеть тот же
-- круг лиц, что и сами работы, иначе присутствие покажет чужие имена.
--
-- Хелпер отдельной функцией, а не выражением в политике: голое
-- substring(...)::uuid упало бы на кривом топике, а топик приходит от
-- клиента. Функция возвращает NULL на всём, что не подходит под шаблон,
-- а course_is_staff(NULL) = false (первым условием у неё
-- «p_course_id is not null»). Проверено на образцах, включая
-- 'hw-review:', 'hw-review:not-a-uuid' и топик с хвостом после uuid.
--
-- Проверено после применения ровно так, как это вычислит Realtime
-- (set role authenticated + request.jwt.claims + GUC realtime.topic,
-- set_config в подзапросе FROM — см. ловушку в CLAUDE.md):
--   владелец курса, свой топик ............... true
--   посторонний преподаватель, тот же топик .. false
--   владелец курса, топик чужого курса ....... false
--   владелец курса, 'hw-review:not-a-uuid' ... false
--   владелец курса, префикс 'secret:' ........ false
--   без JWT .................................. false

create or replace function public.realtime_review_topic_course(topic text)
returns uuid
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when topic ~ '^hw-review:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(topic from 11)::uuid
  end
$$;

comment on function public.realtime_review_topic_course(text) is
  'Достаёт course_id из топика Realtime «hw-review:<uuid>». Возвращает NULL на любом другом топике — чтобы политика не падала на данных от клиента.';

grant execute on function public.realtime_review_topic_course(text) to authenticated;

drop policy if exists hw_review_presence_read on realtime.messages;
create policy hw_review_presence_read on realtime.messages
  for select to authenticated
  using (
    extension in ('presence', 'broadcast')
    and public.course_is_staff(public.realtime_review_topic_course(realtime.topic()))
  );

drop policy if exists hw_review_presence_write on realtime.messages;
create policy hw_review_presence_write on realtime.messages
  for insert to authenticated
  with check (
    extension in ('presence', 'broadcast')
    and public.course_is_staff(public.realtime_review_topic_course(realtime.topic()))
  );
