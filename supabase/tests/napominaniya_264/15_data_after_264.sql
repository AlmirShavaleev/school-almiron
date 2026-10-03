-- §264. Данные, которым нужны объекты PENDING_264 (грузятся после него):
--   Лейла (4) выключила у себя «Срок ДЗ завтра»; в курсе R2 учитель выключил «Срок ДЗ завтра»;
--   в курсе R учитель включил «Пробник завтра» (по умолчанию выключен).
update public.notification_prefs set remind_hw_due_tomorrow = false where user_id = '00000000-0000-4000-8264-000000000004';
insert into public.course_reminder_settings (course_id, hw_due_tomorrow, updated_by) values
  ('30000000-0000-4000-8264-000000000002', false, '00000000-0000-4000-8000-0000000000c1');
insert into public.course_reminder_settings (course_id, mock_tomorrow, updated_by) values
  ('30000000-0000-4000-8264-000000000001', true, '00000000-0000-4000-8000-0000000000c1');
