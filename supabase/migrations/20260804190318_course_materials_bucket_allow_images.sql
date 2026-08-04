-- Материалы темы должны прикрепляться картинками, а не только PDF
-- (решение владельца 2026-08-04).
--
-- Новые материалы лежат в бакете topic-materials, у него ограничения по типам
-- нет вовсе — там картинки грузились и раньше. А легаси-путь (topic_materials,
-- окно темы) пишет в course-materials, где список типов зажат до
-- pdf / png / jpeg / docx / pptx. После того как в интерфейсе разрешили
-- `image/*`, получилось расхождение: файл выбирается, а хранилище его
-- отвергает уже после загрузки — ошибкой, из которой не видно, что не так.
--
-- Добавляем ровно недостающие картиночные типы. webp — обычный формат для
-- скриншотов, heic/heif снимает любой айфон, gif встречается в разборах.
-- Ничего не убираем: docx и pptx материалам по-прежнему нужны.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/png',
     'image/jpeg',
     'image/jpg',
     'image/webp',
     'image/gif',
     'image/heic',
     'image/heif',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation'
   ]
 where id = 'course-materials';
