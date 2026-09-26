-- §229. Состояние ДО миграции: снимок того, что перенос обязан сохранить.
create table probe_before_229 as
select me.id as mock_exam_id, me.condition_path, me.solution_path, k.answers as key_answers,
       (select count(*) from group_students gs where gs.group_id = me.group_id) as group_size
  from mock_exams me left join mock_exam_answer_keys k on k.mock_exam_id = me.id;
