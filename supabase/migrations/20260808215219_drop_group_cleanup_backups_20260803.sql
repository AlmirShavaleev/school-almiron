-- Снимки отката уборки групп 03.08 (§61/§64) сносятся: закон «один курс =
-- одна группа» держит база с четырёх сторон пятый день, откатывать некуда и
-- незачем. Решение владельца 08.08.
--
-- Копии этих трёх таблиц лежат в схеме cleanup_20260808 — выбрасывать архив
-- без копии значит повторять ту же ошибку, от которой архив и защищал.
--
-- Каталожные снимки (catalog_topics_title_backup_20260803,
-- catalog_task_topics_rehang_backup_20260803) НЕ трогаем: владелец списки тем
-- глазами ещё не смотрел, вопрос висит с 3 августа.
-- catalog_tasks_multichoice_backup_20260805 оставлен до сентября — правка свежая.

drop table if exists public.groups_cleanup_backup_20260803;
drop table if exists public.group_students_cleanup_backup_20260803;
drop table if exists public.enrollment_invites_cleanup_backup_20260803;
