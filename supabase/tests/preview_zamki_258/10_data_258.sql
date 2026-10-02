-- §258. Данные поверх §240 (после 15_data_after_240): «Ответы и критерии» у N
-- (видимые) и у F (скрытые учителем — is_visible = false, флаг не должен их
-- считать); у L критериев нет вовсе. Условие у F — видимое (окно завтра).
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by, is_visible) values
  ('00000000-0000-4000-8000-0000007a0005', 'file', 'Ответы и критерии', '00000000-0000-4000-8000-0000007a0005/crit.pdf', 'crit.pdf', 'application/pdf', 3, 'criteria', '00000000-0000-4000-8000-0000000000a1', true),
  ('00000000-0000-4000-8000-0000007a0003', 'file', 'Ответы и критерии', '00000000-0000-4000-8000-0000007a0003/crit.pdf', 'crit.pdf', 'application/pdf', 3, 'criteria', '00000000-0000-4000-8000-0000000000a1', false);
insert into storage.objects (bucket_id, name) values
  ('topic-materials', '00000000-0000-4000-8000-0000007a0005/crit.pdf'),
  ('topic-materials', '00000000-0000-4000-8000-0000007a0003/crit.pdf');
