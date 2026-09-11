-- Канал присутствия `school-presence` снят: присутствие переехало в таблицу
-- отметок (миграция school_presence_marks).
--
-- Почему канал не подошёл — записано там же и в §148. Коротко: чтобы
-- ОТМЕТИТЬСЯ в канале, клиенту нужно право ЧИТАТЬ его, а читать список
-- владелец разрешил только админу. Механизм не выходил за пределы ветки
-- work/live-dashboard, на main им никто не пользовался.
--
-- СНИМАЕМ РОВНО ДВЕ ПОЛИТИКИ. Соседние `hw_review_presence_read` и
-- `hw_review_presence_write` обслуживают присутствие в проверке ДЗ (§31) —
-- они живые, работают на проде и здесь не трогаются. Имена проверены
-- выборкой из pg_policy перед удалением, а не на память.
drop policy if exists school_presence_read  on realtime.messages;
drop policy if exists school_presence_write on realtime.messages;
