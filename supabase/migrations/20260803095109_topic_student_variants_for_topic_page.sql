-- Ученик не видел привязанное к теме тестирование на самой теме: получал его
-- только в списке своих тестирований. Эта функция кормит вкладку «Тест».
--
-- SECURITY DEFINER вынужденно: у ученика нет и не должно быть SELECT-политики
-- на test_variant_assignments (там видно, кому ещё выдан тест), а именно там
-- лежит topic_id. Поэтому доступ проверяется явно и ровно теми же условиями,
-- что и остальные материалы темы:
--
--   1. course_student_can_see_topic(topic_id) — закрытая тема закрывает и тест.
--      Готовый хелпер, а не ручная копия условия: рассинхрон ручных копий уже
--      дважды порождал крупные баги (§21, §29).
--   2. s.profile_id = auth.uid() — на теме видно ТОЛЬКО выданное этому ученику,
--      а не всё привязанное к теме. У невыданного ничего не мигает.
--
-- Возвращается student_assignment_id, потому что проход варианта с темы обязан
-- вести в тот же экран, что и из списка: второго пути прохождения нет.

create or replace function public.topic_student_variants(p_topic_id uuid)
returns table (
  student_assignment_id uuid,
  variant_id            uuid,
  title                 text,
  subject               text,
  exam_type             text,
  tasks_count           integer,
  status                text,
  due_at                timestamptz,
  score                 numeric,
  max_score             numeric,
  percentage            numeric,
  grading_status        text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    tvsa.id, tv.id, tv.title, tv.subject, tv.exam_type, tv.tasks_count,
    tvsa.status, tvsa.due_at, tvsa.score, tvsa.max_score, tvsa.percentage, tvsa.grading_status
  from public.test_variant_student_assignments tvsa
  join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
  join public.test_variants tv             on tv.id  = tvsa.variant_id
  join public.students s                   on s.id   = tvsa.student_id
  where tva.topic_id = p_topic_id
    and s.profile_id = auth.uid()
    and tvsa.status <> 'cancelled'
    and public.course_student_can_see_topic(p_topic_id)
  order by tv.title;
$$;

comment on function public.topic_student_variants(uuid) is
  'Тестирования темы, выданные этому ученику. Доступ — course_student_can_see_topic.';

revoke all on function public.topic_student_variants(uuid) from public, anon;
grant execute on function public.topic_student_variants(uuid) to authenticated;
