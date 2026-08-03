-- Резервирование номеров разделов PROJECT_STATE отменено: номер берётся фактом,
-- по последнему разделу в файле. §48 успел занять чат ИИ-проверки, раздел про
-- автосборку тестов получил §52. Комментарии функций правим, чтобы ссылка из
-- базы вела в существующий раздел, а не в чужой.

comment on function public.variant_level_scale(text, text) is
  'Какая шкала сложности действует у экзамена: three | two | none. §52';

comment on function public.variant_task_level(text, text, text, smallint) is
  'Уровень задачи в шкале своего экзамена. difficulty приоритетнее, иначе exam_part. §52';

comment on function public.variant_topic_availability(text, text, uuid[], text) is
  'Сколько задач с эталоном доступно по каждой теме и уровню — для списка тем. §52';

comment on function public.variant_selection_availability(text, text, uuid[], text) is
  'Сколько РАЗНЫХ задач доступно по уровням на всей выборке тем — против задвоения. §52';

comment on function public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text) is
  'Детерминированная случайная выборка задач по темам и раскладке уровней. Без ИИ. Только has_answer. §52';

comment on function public.get_variant_items_for_student(uuid) is
  'Задачи варианта для ученика. Эталон, решение и номер задачи — только после сдачи. §52';

comment on function public.variant_pass_counts(uuid[]) is
  'Выдано и пройдено по каждому варианту. Видимость как у test_variants. §52';
