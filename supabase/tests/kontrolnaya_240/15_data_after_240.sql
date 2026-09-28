-- §240. После PENDING_240: так же, как оркестратор/учитель сделают на проде —
-- тип тем, окна, личные окна, рубрика «Ответы и критерии».
update topics set kind = 'control'
 where id in ('00000000-0000-4000-8000-0000007a0002', '00000000-0000-4000-8000-0000007a0004', '00000000-0000-4000-8000-0000007a0005');
update topics set kind = 'check' where id = '00000000-0000-4000-8000-0000007a0003';
update topic_homework set opens_at = now() - interval '10 minutes', closes_at = now() + interval '30 minutes'
 where id = '00000000-0000-4000-8000-0000000d0002';
update topic_homework set opens_at = now() + interval '1 day', closes_at = now() + interval '1 day 45 minutes'
 where id = '00000000-0000-4000-8000-0000000d0003';
update topic_homework set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 hour'
 where id = '00000000-0000-4000-8000-0000000d0004';
-- S3 сдал за 10 минут до закрытия.
update topic_homework_attempts set submitted_at = now() - interval '70 minutes'
 where id = '00000000-0000-4000-8000-00000c0a0003';
insert into topic_homework_personal_windows (homework_id, student_id, opens_at, closes_at, created_by) values
  ('00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-0000000001b4', now() - interval '10 minutes', now() + interval '20 minutes', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000d0004', '00000000-0000-4000-8000-0000000001b5', now() - interval '40 minutes', now() - interval '30 minutes', '00000000-0000-4000-8000-0000000000a1');
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by)
select t.id, 'file', 'Ответы и критерии', t.id || '/crit.pdf', 'crit.pdf', 'application/pdf', 3, 'criteria', '00000000-0000-4000-8000-0000000000a1'
  from (values ('00000000-0000-4000-8000-0000007a0002'::uuid, 'k'), ('00000000-0000-4000-8000-0000007a0004'::uuid, 'c')) t(id, code);
insert into storage.objects (bucket_id, name) values ('topic-materials', '00000000-0000-4000-8000-0000007a0002/crit.pdf'),
                                             ('topic-materials', '00000000-0000-4000-8000-0000007a0004/crit.pdf');
