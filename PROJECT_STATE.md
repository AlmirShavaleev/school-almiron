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

---

## 8. Сессия 2026-07-26: инфраструктура + первые фичи (снимок после)

Сделано (всё в проде):

- **Деплой**: Vercel ← GitHub `AlmirShavaleev/school-almiron`, автодеплой из `main`.
  `vercel.json`: build `npx vite build` (полный `tsc -b` красный из-за легаси
  `LessonHomeworkV2Card` — обращается к снесённой `homework_templates.lesson_id`).
- **Домен**: `alminion.ru` (Beget → NS Cloudflare). Сайт на apex, DNS в Cloudflare.
  Vercel-домен: CNAME @ → vercel-dns, DNS only. Supabase Auth Site URL/redirects обновлены.
- **Картинки каталога → Cloudflare R2**: бакет `catalog-assets`, custom domain
  `assets.alminion.ru`, transform-правила чинят Content-Type (png/jpg были залиты как svg).
  Перекачка rclone с машины владельца (конфиг в `r2-migration/`, в git не входит).
  Фронт: `VITE_ASSETS_BASE_URL` (пусто = Supabase, задано = R2) — `getAssetUrl` в useCatalog.
  ОСТАЛОСЬ: дождаться конца rclone → задать env в Vercel → редеплой → через 2 недели
  удалить catalog-assets из Supabase Storage (вернёт БД под 500 МБ: -344 МБ storage.objects).
  Сироты каталога проверены: 0 (108k «сирот» из стороннего отчёта — артефакт URL-кодировки).
- **SMTP**: Resend (домен verified, регион eu-west-1), Supabase Custom SMTP
  (smtp.resend.com:465, user resend, sender noreply@alminion.ru). Проверено: Delivered.
  Шаблоны писем русифицированы (сброс, подтверждение, приглашение, magic link);
  шаблон «смена email» не дался — страница дашборда висла, доделать.
- **Навигация**: легаси скрыто флагом `hidden: true` в Sidebar (страницы живы по URL).
  Ученик: кабинет, курс, каталог, прогресс, настройки. Персонал: кабинеты, программа,
  каталог, Проверка ДЗ, группы, ученики, настройки. NotificationBell скрыт.
- **Очередь проверки ДЗ** (§7.4 — закрыто): `/homework-queue`, все submitted-попытки
  по всем курсам, старые сверху, группировка по курсам, вердикт тем же RPC.
  Код: `lib/homeworkQueue.ts` (+тесты), `hooks/useHomeworkReviewQueue.ts`,
  `pages/HomeworkReviewQueuePage.tsx`, ReviewActions экспортирован из TopicHomeworkReview.

Известные хвосты: Vercel env создавались заново (при первом деплое не сохранились);
переменные называются VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, sensitive.
Мост Claude не умеет удалять файлы → в `.git/` копятся `*.lock*`-хвосты, удалять руками.

## 9. Продуктовые решения владельца (2026-07-26) — рамка MVP

1. **Курс = одна группа.** Новая группа людей = новый курс. Схему не менять,
   это конвенция; UI выбора групп можно упрощать.
2. **Материалы**: пополняются в темах в течение года (текущая реализация ок).
3. **ДЗ существует ТОЛЬКО в теме** (topic_homework). Других систем ДЗ в продукте нет
   и не будет — легаси сносить по карте §4 после обкатки.
4. **Тестирование тем (следующая большая фича, §3)**: задания берутся ТОЛЬКО из
   каталога; проверка ТОЛЬКО автоматическая по ответу, независимо от части (1/2)
   и экзамена (ОГЭ/ЕГЭ). Ручной проверки тестов НЕТ. Следствия:
   - в конструктор теста допускаются только задачи с текстовым эталоном
     (has_answer и непустой ответ после strip тегов; ~16.5 тыс. из 21.8 тыс.);
   - баллы из каталога (max_points), частичные — score_auto_answer/partial_type;
   - снапшот условия/ответа/типа/балла при добавлении в тест — обязателен (см. §3);
   - часть 2 оценивается по ответу «всё или ничего» — осознанное упрощение владельца.

## 10. Сессия 2026-07-26 (вечер): тестирование тем — РЕАЛИЗОВАНО (§3 закрыт)

Бэкенд (миграция `20260726130727_topic_tests`, применена через MCP, файл в
`supabase/migrations/`; прогнана на локальном Postgres с заглушками и
поведенческими тестами ролями — всё зелёное):

- `topic_tests` (один тест на тему, UNIQUE(topic_id), is_published),
  `topic_test_items` (снапшот catalog_tasks: statement/answer/solution_html,
  answer_text — эталон после strip тегов, partial_type, max_points, exam_part,
  assets jsonb; UNIQUE(test_id, task_id)), `topic_test_attempts`
  (ОДНА попытка: UNIQUE(test_id, student_id), in_progress → completed,
  totals при завершении), `topic_test_answers` (пишутся только RPC).
- RPC: `topic_test_add_item` (снапшот делает база; отклоняет задачи без
  текстового эталона), `topic_test_student_items` (эталоны null до завершения
  попытки — ученику прямой SELECT items закрыт, эталон в той же строке),
  `topic_test_start_attempt` (идемпотентна), `topic_test_save_answer`,
  `topic_test_submit_attempt` (автопроверка всей попытки одной транзакцией).
- Проверка: `topic_test_score_item` ПЕРЕИСПОЛЬЗУЕТ score_auto_answer /
  normalize_*; нюанс: для обычных ответов БЕЗ цифр score_auto_answer слеп
  (сравнивает только цифры) — такие сравниваются normalize_variant_answer.
  Частичные (matching/multi_choice) — 0..2 от score_auto_answer; остальное —
  всё или ничего × max_points (решение владельца, §9.4).
- Инварианты триггерами: состав заданий заморожен после первой попытки,
  снапшот неизменяем (кроме position), завершённая попытка и её ответы
  неизменяемы, баллы выставляет только submit-RPC.

Фронт (частично написан субагентами, отревьюен):

- `src/lib/topicTest.ts` (+ topicTest.test.ts, 27 тестов) — типы и чистые
  помощники; `hasTextAnswer` — клиентское зеркало серверной проверки эталона.
- `src/hooks/useTopicTest.ts` — useTopicTest (преподаватель) и
  useTopicTestStudent (ученик).
- Преподаватель: `TopicTestEditor` в TopicMaterialsModal (секция
  «Тестирование»): создать/переименовать/опубликовать/удалить, добавление
  задач из каталога (предмет → экзамен → раздел → поиск useCatalogSearch,
  задачи без текстового эталона задизейблены), плашка о заморозке состава.
- Ученик: `TopicTestStudent` на TopicPage: старт (с предупреждением про
  одну попытку), ответы с сохранением на blur, завершение с confirm про
  пустые, результат (баллы, %, разбор: свой ответ / балл / эталон /
  решение в details).
- `src/types/database.ts` перегенерирован целиком.

Не сделано / хвосты: очистка ответов при удалении теста преподавателем до
попыток — каскадом, ок; результаты теста в журнале/дашбордах НЕ показываются
(журнал легаси, см. §5.4); teacher-view результатов по группе — только через
таблицы attempts/answers, отдельного UI нет (следующая итерация).

### 10.1. Плиточная модалка темы + рубрики материалов

- Миграция `20260726135515_topic_material_items_section`: колонка
  `topic_material_items.section` ('notes'|'theory'|'tasks'|'solution', NULL = без рубрики).
- Модалка темы (canEdit): 7 одинаковых плиток — Конспект / Теория / Задачи /
  ДЗ / Решение ДЗ / Видео / Тестирование; клик раскрывает панель (мультизагрузка
  файлов с прогрессом / ссылка на видео / TopicHomeworkEditor / TopicTestEditor).
  Зелёная точка = рубрика заполнена. Дата «Открывается» в шапке. Старая полная
  форма — в details «Прочие материалы (без рубрики)».
- MaterialsMatrix в CourseProgramPage переведена со старой topic_materials на
  topic_material_items(section/kind) + topic_homework + topic_tests — колонки
  совпадают с плитками. (Ученические has_notes/has_theory в
  useStudentCourseProgram — всё ещё легаси, см. §4 оч.7.)

### 10.2. Банк тестов (миграция 20260726142040_topic_test_bank)

Продуктовые решения владельца: тест — сущность банка (страница /tests),
составляется из каталога, имеет название; к теме прикрепляется
(topic_test_assignments, UNIQUE(topic_id)); ПОПЫТКА НА ПРИВЯЗКУ
(UNIQUE(assignment_id, student_id)) — тот же тест в другой теме проходится
заново; видимость ученика — через привязку к доступной теме
(is_published — легаси-флаг, в видимости не участвует).

- topic_tests.topic_id удалён; банк: персонал школы читает всё, правит
  автор/admin/owner (topic_test_bank_*). Пустой тест не прикрепляется,
  привязка с попытками не открепляется (триггеры).
- RPC ученика на привязках: topic_test_assignment_items,
  topic_test_start_attempt(assignment); save/submit прежние.
- Фронт: /tests (TestBankPage), /tests/:testId (TestBankTestPage —
  конструктор + вкладка «Результаты»: по привязкам, таблица учеников,
  баллы/%/дата), пункт «Тесты» в Sidebar. Плитка «Тестирование» в модалке
  темы = прикрепить/открепить тест из банка (TopicTestEditor переписан).
  Хуки: useTestBank / useBankTest / useTestResults / useTopicTestAssignment /
  useTopicTestStudent (через привязку). Из модалки убраны «Прочие материалы»
  и старая форма «Добавить материал».
