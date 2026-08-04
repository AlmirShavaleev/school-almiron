-- heic во всех загрузках (решение владельца 2026-08-04, по разведке §81.3).
--
-- Общий знаменатель всех зажатых мест — `heic`: айфон снимает именно в нём, и
-- файл отвергался хранилищем уже ПОСЛЕ загрузки, ошибкой, из которой ученику
-- не видно, что не так. Живой контур ДЗ тем временем heic принимает: у
-- topic-homework-attempts ограничения нет вовсе, а SubmissionReviewer держит
-- heic в списке картинок сознательно.
--
-- Ничего не убираем, только добавляем недостающее. `image/jpg` — не настоящий
-- тип, но некоторые браузеры присылают именно его, и в части бакетов он уже
-- был; выравниваем, чтобы поведение не зависело от бакета.

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
     'image/gif', 'image/heic', 'image/heif'
   ]
 where id = 'homeworks';

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
     'image/gif', 'image/heic', 'image/heif',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
   ]
 where id = 'lesson-materials';

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
     'image/heic', 'image/heif'
   ]
 where id = 'task-submissions';

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
     'image/heic', 'image/heif'
   ]
 where id = 'variant-solutions';
