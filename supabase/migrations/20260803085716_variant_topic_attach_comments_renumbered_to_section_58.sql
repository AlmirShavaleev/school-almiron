-- Номера разделов PROJECT_STATE выдаются фактом, и пока шла работа, §56 и §57
-- заняли другие чаты. Привязка тестов к темам курса получила §58, а группировка
-- тем по номерам заданий — §56. Правим ссылки, чтобы из базы они вели в
-- существующие разделы.

comment on column public.test_variant_assignments.topic_id is
  'Тема курса, из которой выдан тест. NULL — выдача из раздела «Тесты». §58';

comment on function public.variant_topic_groups(uuid) is
  'Группы курса, которому принадлежит тема, — для выбора при привязке теста. §58';

comment on function public.attach_variant_to_topic(uuid, uuid, uuid[], timestamptz) is
  'Привязать тест к теме курса = выдать его выбранным группам курса. §58';

comment on function public.detach_variant_from_topic(uuid, uuid) is
  'Отвязать тест от темы курса и снять выдачи. Отказывает, если работу уже начали. §58';

comment on function public.topic_attached_variants(uuid) is
  'Тесты, привязанные к теме курса, со счётчиками выдачи и прохождений. §58';

comment on function public.variant_topic_availability(text, text, uuid[], text) is
  'Задачи с эталоном по темам и уровням, с номером задания для группировки. §56';
