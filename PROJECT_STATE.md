# PROJECT_STATE — School Almiron

Handover-документ для нового чата/аудита. Составлен 2026-07-26 по итогам большого
рефакторинга сущностей заданий. Это снимок реального состояния, а не план.

Проект Supabase: **School** (`kthfozyfruorwjhvvsbw`).
Стек: Vite + React 19 + TS + Tailwind, Supabase (PostgREST + RLS + Storage + Edge Functions),
vitest, playwright. Деплоя пока нет — следующий шаг Vercel.

---

## 1. Продуктовая модель (актуальная, MVP)

```
Курс → Модуль («Основной», скрыт в UI) → Тема
                                           ├── материалы: текст / видео / ссылка / файл
                                           ├── одно PDF-ДЗ: попытки → проверка → принято/на доработку
                                           └── тестирование из каталога задач  ← НЕ РЕАЛИЗОВАНО
```

Ключевые решения, выстраданные в ходе рефакторинга (не переигрывать без причины):

- Сущности «урок» в пользовательской логике НЕТ. Материалы и ДЗ висят на теме.
  `lessons` — расписание занятий (scheduled_at, group_id, zoom), лежит нетронутым до
  возврата расписания; в MVP не используется.
- Модули технически обязательны (`topics.module_id` NOT NULL), поэтому скрыты:
  триггер `courses_default_module` создаёт модуль «Основной» каждому курсу.
- У PDF-ДЗ нет баллов, дедлайнов и назначения группам. Только
  принято / возврат с комментарием. Несколько попыток, история не затирается.
- Доступ ученика везде один: `group_students → groups.course_id` (+ мёртвая ветка
  `student_courses` — пуста, оставлена на будущее) + `topics.available_from`.
- Конвенция: автор/учитель/проверяющий → `profiles.id` (= auth.uid()),
  ученик → `students.id`. Легаси-системы её нарушают, новые — нет.

---

## 2. Что РЕАЛЬНО работает (новый MVP-контур)

Таблицы (все с RLS, применены к боевой базе):

| Миграция | Объекты |
|---|---|
| `20260725222605_course_lessons_and_materials` | `course_lessons` (рудимент, см. §4), `course_lesson_materials` → переименована ↓ |
| `20260725223951_course_lessons_harden_function_grants` | отзыв EXECUTE у anon/PUBLIC |
| `20260726062211_topic_material_items_repoint_to_topics` | `topic_material_items` (материалы темы) |
| `20260726064027_copy_topic_materials_into_topic_material_items` | перенос 3 строк из старой `topic_materials` |
| `20260726073913_topic_homework` | `topic_homework`, `_files`, `_attempts`, `_attempt_files`, `_reviews` |

RPC: `topic_homework_start_attempt` (идемпотентна), `topic_homework_submit_attempt`,
`topic_homework_review_attempt` (review + статус одной транзакцией; при возврате
комментарий обязателен — CHECK).

Статусы попытки ДЗ: `draft → submitted → accepted | returned_for_revision`
(терминальные неизменяемы, пересдача после accepted запрещена триггером,
один активный цикл — частичный UNIQUE).

Storage-бакеты нового контура: `topic-materials`, `topic-homework`,
`topic-homework-attempts` (приватные; первый сегмент пути = topic_id/attempt_id,
на этом держатся storage-политики). Легаси-бакеты: `course-materials` (файлы
перенесённых материалов физически там, фронт выбирает бакет по префиксу пути —
`bucketForMaterialPath`), `course-lesson-materials` (1 файл периода уроков),
`homeworks` (101 файл Homework V1, 31 МБ).

Frontend нового контура:

- Преподаватель: `/course-program` → тема → «Редактировать тему»
  (`TopicMaterialsModal`) → материалы (`TopicMaterialItems`) + ДЗ
  (`TopicHomeworkEditor` + локальная проверка `TopicHomeworkReview`).
- Ученик: `/my-course/:groupId/topic/:topicId` (`TopicPage`) → материалы + ДЗ
  (`TopicHomeworkStudent`): скачать PDF, попытки, история, статусы.
- Слой данных: `src/lib/topicMaterialItems.ts`, `src/lib/topicHomework.ts` (чистые
  хелперы + тесты), `src/hooks/useTopicMaterialItems.ts`, `src/hooks/useTopicHomework.ts`.
- Принцип: клиент НЕ дублирует RLS. Скрытие кнопок — UX, запреты держит база.

Ролевая модель: student / teacher / curator / admin / owner (`profiles.role`,
`RoleGuard` на маршрутах, роль не персистится в localStorage).

---

## 3. Тестирования — спроектировано, НЕ реализовано

Последняя задача перед паузой. Backend «одно тестирование на тему» был заказан,
изучение каталога сделано, миграция НЕ написана. Что уже выяснено:

- Эталон ответа: `catalog_tasks.answer_html`; флаг `has_answer` достоверен.
  16 582 задачи из 21 783 с ответом; вся часть 1 (15 539) автопроверяема;
  ~3.6 тыс. хранят ответ картинкой-формулой (после strip тегов пусто) — только ручная.
- В каталоге есть готовые поля: `max_points` (1–4), `partial_type`
  (matching / multi_choice), `exam_part`, `grade_criteria_html`.
- Готовые функции проверки, ПЕРЕИСПОЛЬЗОВАТЬ, не писать свои:
  `normalize_variant_answer(text)`, `normalize_answer_digits(text)`,
  `score_auto_answer(student, correct, partial_type)` (+ `score_partial_matching`,
  `score_partial_multi_choice`). Все IMMUTABLE.
- Требование: snapshot условия/ответа/типа проверки/балла при добавлении задания
  в тест (правки каталога не меняют выставленные баллы задним числом).
- Ранее спроектированный полный модуль quiz_* лежит в `outputs` прошлой сессии —
  устарел (был на lesson_id), но решения по нормализации/снимкам оттуда валидны.

---

## 4. Легаси: живо, но не используется. Карта сноса

НИЧЕГО из этого ещё не удалено — строили аддитивно. Это главный источник
ощущения «слишком сложно». Очереди сноса (только после того, как новый контур
поживёт в проде):

| Очередь | Что | Строк данных | Зачем ждать |
|---|---|---|---|
| 1 | Homework V1: `homeworks`, `homework_submissions`, `homework_submission_files`, `annotation_sets` | 0 | заменён topic_homework |
| 2 | Homework V2: `homework_templates` + 12 таблиц ветки | 3 шаблона, 16 items | выгрузить items перед сносом |
| 3 | `test_variants` + 5 таблиц ветки | 8 вариантов, 77 заданий | заменится новым тестированием; функции проверки (score_*, normalize_*) ОСТАВИТЬ |
| 4 | `task_collections`, `task_collection_items`, `assigned_collections`, `assigned_collection_members`, `task_submissions` | 36 подборок, 410 items — выгрузить! | связаны с копированием уроков (оч. 5) |
| 5 | `lesson_templates` + ветка, `finalize_lesson_copy`, `rollback_lesson_copy`, edge fn `copy_lesson` | 7 шаблонов | сносить вместе с оч. 4 |
| 6 | `course_lessons` (1 строка «бджбдж»), колонка `topic_material_items.lesson_id`, функции `course_student_can_see_lesson`, `course_is_lesson_staff`, бакет `course-lesson-materials` | 1 урок, 1 файл | рудимент отменённой модели уроков |
| 7 | `topic_materials` (3 строки, УЖЕ скопированы в topic_material_items), `useTopicMaterials`, `TopicMaterialsModal`-секции старой модели, `topicLinkMaterials.ts` | 3 | на ней флаги has_notes/has_theory в `useStudentCourseProgram` и `LessonDetailPage` |
| 8 | ~60 функций старых модулей, 8 enum, старые RLS/storage-политики | — | после оч. 1–7 |

НЕ УДАЛЯТЬ НИКОГДА: `catalog_*` (5 таблиц, ~340 тыс. строк — источник контента).

Справочник по старому периметру: `outputs/_archive_v1/01_drop_legacy.НЕ_ПРИМЕНЯТЬ.sql`
прошлой сессии (перечень функций/зависимостей; применять нельзя — сносит коллекции).

Вне контура заданий, но тоже легаси в UI: посещаемость, расписание, оплаты
(YooKassa edge functions живы, не вызываются), уведомления/Telegram, mock exams,
лидерборд, приглашения. Скрыть из навигации при аудите — кандидаты очевидны
по AppRoutes.tsx.

---

## 5. Известные проблемы (для аудита)

1. **`tsc -b` красный ДО всех моих изменений**: ~41 ошибка в 14 старых тестах —
   `tsconfig.app.json` имеет `"types": ["vite/client"]`, а тесты используют fs/path/process.
   Чинится `"types": ["vite/client", "node"]`. Build (`vite build`) при этом зелёный.
2. **`distribution_flow_requests` — RLS ВЫКЛЮЧЕН**, 2 строки, открыта anon-ключу
   на чтение и запись. Включать RLS без политик нельзя (всё сломается) — сначала
   решить, кто должен её видеть.
3. **Advisors**: ~160 WARN (фон легаси). По новому контуру только
   `authenticated_security_definer_function_executable` на хелперах, нужных
   RLS-политикам — это осознанно и неустранимо.
4. `get_student_journal()` читает легаси-таблицы. Работает, но журнал не знает
   о topic_homework. Переписать до сноса очереди 1–4 (зависимость через тело
   функции — DROP CASCADE не предупредит).
5. `queue_collection_notification()` — сирота с захардкоженными entity_type
   старых систем. Уведомления нового контура не подключены вовсе.
6. Двойной интерфейс материалов частично остался: в `TopicMaterialsModal` секции
   старой `topic_materials` (7 фикс. типов) удалены, но `LessonDetailPage` и
   карточки прогресса ученика (`has_notes`/`has_theory`) всё ещё читают старую таблицу.
7. В корне репозитория мусор: import-логи, чекпоинты, скриншоты, `shkolkovo-*`
   (~17 МБ json). Почистить + .gitignore.
8. `MIGRATIONS.md` — ВАЖНО: `supabase db push` ЗАПРЕЩЁН. Миграции применяются
   через MCP, файл кладётся в `supabase/migrations/` только после применения,
   имя = version из remote `schema_migrations`. `_pending/` — для неприменённых.
9. Демо-контур (`demo_users` 15 строк, `demo-impersonate` edge fn) — статус неясен.

---

## 6. Как работать с этим репо (выучено на практике)

- Focused-тесты: `npx vitest run <файлы>`; полный прогон медленный. Соглашение:
  чистая логика в `src/lib/*.test.ts`, компоненты в `src/components/__tests__/`.
- Typecheck точечно: tsconfig с `"files": [...]` (полный `tsc -b` красный, см. §5.1).
- Перед любой миграцией — прогон на локальном Postgres с заглушками
  (профили/студенты/группы/темы + auth.uid() + storage.*), поведенческие тесты
  ролями `set role authenticated` + `request.jwt.claim.sub`. Это уже трижды
  ловило реальные баги.
- Проверки на боевой базе — только в транзакции с `rollback`, через временную
  таблицу результатов с grant для тестовых ролей.
- `generate_typescript_types` → результат в файл → перезаписать
  `src/types/database.ts` целиком (сгенерирован, руками не править).
- В боевой базе есть реальные люди: преподаватель-владелец двух курсов
  (43396c60…), ученик Almir Shavaleev (profile 0e26a665…, student 63d7efce…),
  группа с одним учеником. Курс «егэ» — чужой владелец, годится для негативных тестов.

---

## 7. Ближайшие шаги (были согласованы до паузы)

1. Деплой на Vercel (не сделан; env: VITE_SUPABASE_URL/ANON_KEY из `.env`).
2. Аудит + продуктовые решения: что скрыть/удалить, пощупав живой UX.
3. Тестирование на уровне темы (backend по §3, миграция в `_pending`).
4. Общая очередь проверки ДЗ у преподавателя (сейчас проверка только внутри темы).
5. Снос легаси очередями §4 — после обкатки.
