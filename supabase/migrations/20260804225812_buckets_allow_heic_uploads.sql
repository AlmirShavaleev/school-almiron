-- heic/heif во все загрузки, где уже разрешены картинки (решение владельца
-- 2026-08-04, продолжение §81).
--
-- Общий знаменатель четырёх бакетов: айфон снимает в heic, и до этой миграции
-- фотография работы отвергалась хранилищем уже ПОСЛЕ загрузки — ошибкой, из
-- которой ученику не видно, что не так. Самый частый способ сдать работу бил
-- по самому непонятному отказу.
--
-- Добавляем только heic/heif. Ничего не убираем и pdf нигде не трогаем:
-- задача — снять зажим, а не переопределить, что куда можно класть.
--
-- topic-homework-attempts и topic-homework (живой контур ДЗ тем) здесь не
-- упомянуты намеренно: у них allowed_mime_types = null, ограничения нет вовсе.

update storage.buckets
   set allowed_mime_types = allowed_mime_types || array['image/heic', 'image/heif']
 where id in ('homeworks', 'lesson-materials', 'task-submissions', 'variant-solutions')
   and not (allowed_mime_types @> array['image/heic', 'image/heif']);
