# Homework Architecture Plan

## 1. Текущие проблемы

### Два пути сдачи ДЗ
Сейчас в системе существуют **два несовместимых пути**, оба записывают в `homework_submissions`:

**Путь A — "Формальные ДЗ"** (`StudentCoursePage.tsx`, `HomeworksPage.tsx`)
- Учитель создаёт запись в `homeworks` с привязкой к `group_id` + `topic_id`
- Ученик нажимает "Сдать ДЗ" на карточке темы
- Submission: `homework_id = <id>`, остальные поля null

**Путь B — "Свободная сдача"** (`TopicPage.tsx`)
- Формального ДЗ нет, но ученик открывает страницу темы и видит форму сдачи
- Submission: `homework_id = NULL`, `topic_id = <id>`, `group_id = <id>`

### Последствия
- `homework_submissions.homework_id` — NULLABLE, это нарушает целостность
- `HomeworksPage` у учителя разбит на 2 вкладки ("Формальные ДЗ" / "Сдачи по темам") — учитель теряет тематические сдачи
- `useTeacherDashboard` считает только формальные pending submissions → счётчик "На проверке" занижен
- Сложные RLS-политики с двойной проверкой (`group_id IS NOT NULL OR homework_id IS NOT NULL`)
- Дублирование запросов в `HomeworksPage`, `useTeacherDashboard`, `useStudentCourseProgram`
- `upsert` конфликтует: для пути B нет уникального ключа по `homework_id,student_id`

---

## 2. Новая схема данных

### `homeworks` (расширить)
```sql
id           uuid PK
group_id     uuid NOT NULL → groups.id
topic_id     uuid → topics.id          -- null = не привязано к теме
lesson_id    uuid → lessons.id         -- null = не привязано к уроку
teacher_id   uuid NOT NULL → teachers.id  -- НОВОЕ: прямая привязка к учителю
title        text NOT NULL
description  text
due_date     timestamptz NOT NULL
max_score    int NOT NULL DEFAULT 100
file_url     text
created_at   timestamptz DEFAULT now()
created_by   uuid → teachers.id        -- оставить для обратной совместимости
```

> `teacher_id` заполняется как `created_by` при создании. В будущем позволяет переназначить ДЗ другому учителю без потери автора.

### `homework_submissions` (упростить)
```sql
id           uuid PK
homework_id  uuid NOT NULL → homeworks.id  -- УБРАТЬ nullable
student_id   uuid NOT NULL → students.id
status       homework_status NOT NULL DEFAULT 'not_submitted'
answer_text  text
file_url     text
score        int
feedback     text
submitted_at timestamptz
checked_at   timestamptz
checked_by   uuid → teachers.id
-- УДАЛИТЬ: topic_id, group_id (они выводятся через homeworks)
```

Уникальное ограничение: `UNIQUE (homework_id, student_id)` — уже должно быть, если нет — добавить.

---

## 3. Роли и доступ

| Роль | Видит homeworks | Видит submissions |
|------|----------------|-------------------|
| Ученик | group_id в его группах | только свои |
| Учитель | created_by = teacher_id | через homeworks.group_id → groups.teacher_id = me |
| Куратор | все в своих группах | через group |
| Родитель | группы ребёнка | только ребёнка |
| Admin/Owner | все | все |

---

## 4. Путь ученика (новый)

```
Ученик открывает тему (/my-course/:groupId/topic/:topicId)
        ↓
TopicPage запрашивает:
  SELECT * FROM homeworks WHERE topic_id = ? AND group_id = ?
        ↓
┌─── ДЗ найдено ─────────────────────────────────┐
│  Показать задание, кнопку "Сдать ДЗ"            │
│  submission: INSERT homework_submissions         │
│    (homework_id = hw.id, student_id = me)        │
└─────────────────────────────────────────────────┘
        ↓
┌─── ДЗ НЕ найдено ──────────────────────────────┐
│  AUTO-CREATE homework:                           │
│    INSERT homeworks (                            │
│      topic_id, group_id,                         │
│      title = "ДЗ: {topic.title}",               │
│      teacher_id = group.teacher_id,              │
│      due_date = +7 days,                         │
│      max_score = 100                             │
│    )                                             │
│  Затем submission с новым homework_id            │
└─────────────────────────────────────────────────┘
```

> Автосоздание ДЗ делается от имени студента, но нужен SECURITY DEFINER или вызов edge function — студент не имеет INSERT в homeworks. **Лучший вариант**: pre-create homework через edge function или trigger при создании темы.

**Рекомендуемый вариант**: При отсутствии ДЗ показывать сообщение "Учитель ещё не назначил задание" — без автосоздания. Это проще и безопаснее. Ученик сдаёт только если есть `homework_id`.

---

## 5. Путь учителя (новый)

```
/homeworks — один список, без вкладок
  ├── Фильтр: На проверке | Проверенные | Просроченные | Все
  ├── Каждая строка: студент · тема · группа · дата · статус
  └── Кнопка "Проверить" → открывает ReviewHomeworkModal

/teacher (дашборд)
  └── Карточка "На проверке: N" → /homeworks?status=submitted
      Считает: SELECT COUNT(*) FROM homework_submissions
               JOIN homeworks ON homeworks.id = homework_submissions.homework_id
               WHERE homeworks.teacher_id = me
                 AND status = 'submitted'
```

---

## 6. Файлы для изменения

### Миграция БД (приоритет 1)
| Файл | Действие |
|------|----------|
| `supabase/migrations/XX_simplify_homeworks.sql` | Новая миграция |

### Хуки (приоритет 2)
| Файл | Действие |
|------|----------|
| `src/hooks/useHomeworks.ts` | Убрать два запроса, один унифицированный |
| `src/hooks/useTeacherDashboard.ts` | Один запрос submissions через `homeworks.teacher_id` |
| `src/hooks/useStudentCourseProgram.ts` | Только `homework_id`, убрать free-sub ветку |

### Страницы (приоритет 2)
| Файл | Действие |
|------|----------|
| `src/pages/HomeworksPage.tsx` | Убрать вкладки, один список с фильтром |
| `src/pages/TopicPage.tsx` | Убрать free-submission ветку, только formal HW |
| `src/pages/StudentCoursePage.tsx` | Без изменений (уже через `hw_id`) |
| `src/pages/teacher/TeacherDashboard.tsx` | Упростить счётчик и карточку |

### Модалки (приоритет 3)
| Файл | Действие |
|------|----------|
| `src/components/modals/SubmitHomeworkModal.tsx` | homework_id обязателен, убрать free-path |
| `src/components/modals/ReviewTopicSubmissionModal.tsx` | Можно удалить или объединить с ReviewHomeworkModal |

---

## 7. SQL-миграции

### Шаг 1 — Добавить `teacher_id` в `homeworks`
```sql
ALTER TABLE homeworks
  ADD COLUMN teacher_id uuid REFERENCES teachers(id);

-- Заполнить из created_by
UPDATE homeworks SET teacher_id = created_by;

-- Сделать NOT NULL
ALTER TABLE homeworks ALTER COLUMN teacher_id SET NOT NULL;
```

### Шаг 2 — Создать placeholder homeworks для free submissions
```sql
-- Для каждой уникальной пары (topic_id, group_id) без formal HW
-- создаём запись в homeworks, затем обновляем submissions
INSERT INTO homeworks (group_id, topic_id, teacher_id, title, due_date, max_score, created_by)
SELECT DISTINCT
  hs.group_id,
  hs.topic_id,
  g.teacher_id,
  COALESCE('ДЗ: ' || t.title, 'Тематическое ДЗ'),
  now() + interval '30 days',
  100,
  g.teacher_id
FROM homework_submissions hs
JOIN groups g ON g.id = hs.group_id
LEFT JOIN topics t ON t.id = hs.topic_id
WHERE hs.homework_id IS NULL AND hs.topic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM homeworks h2
    WHERE h2.topic_id = hs.topic_id AND h2.group_id = hs.group_id
  );
```

### Шаг 3 — Связать free submissions с placeholder homeworks
```sql
UPDATE homework_submissions hs
SET homework_id = h.id
FROM homeworks h
WHERE hs.homework_id IS NULL
  AND hs.topic_id IS NOT NULL
  AND h.topic_id = hs.topic_id
  AND h.group_id = hs.group_id;
```

### Шаг 4 — Проверка и удаление осиротевших
```sql
-- Проверить что не осталось NULL
SELECT COUNT(*) FROM homework_submissions WHERE homework_id IS NULL;

-- Если 0 — делать следующие шаги
ALTER TABLE homework_submissions ALTER COLUMN homework_id SET NOT NULL;

-- Добавить уникальный ключ если нет
ALTER TABLE homework_submissions
  ADD CONSTRAINT hw_sub_unique UNIQUE (homework_id, student_id);
```

### Шаг 5 — Удалить лишние колонки из `homework_submissions`
```sql
ALTER TABLE homework_submissions
  DROP COLUMN IF EXISTS topic_id,
  DROP COLUMN IF EXISTS group_id;
```

### Шаг 6 — Упростить RLS

```sql
-- homework_submissions SELECT
DROP POLICY hw_submissions_select ON homework_submissions;
CREATE POLICY hw_submissions_select ON homework_submissions FOR SELECT USING (
  is_admin_or_owner()
  OR EXISTS (
    SELECT 1 FROM homeworks h
    JOIN groups g ON g.id = h.group_id
    JOIN teachers t ON t.id = g.teacher_id
    WHERE h.id = homework_submissions.homework_id
      AND t.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM homeworks h
    JOIN groups g ON g.id = h.group_id
    JOIN curators c ON c.id = g.curator_id
    WHERE h.id = homework_submissions.homework_id
      AND c.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM students s
    WHERE s.id = homework_submissions.student_id
      AND s.profile_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM parent_students ps
    JOIN parents p ON p.id = ps.parent_id
    WHERE ps.student_id = homework_submissions.student_id
      AND p.profile_id = auth.uid()
  )
);

-- homework_submissions UPDATE (teacher)
DROP POLICY hw_submissions_teacher_update ON homework_submissions;
CREATE POLICY hw_submissions_teacher_update ON homework_submissions FOR UPDATE USING (
  is_admin_or_owner()
  OR EXISTS (
    SELECT 1 FROM homeworks h
    JOIN groups g ON g.id = h.group_id
    JOIN teachers t ON t.id = g.teacher_id
    WHERE h.id = homework_submissions.homework_id
      AND t.profile_id = auth.uid()
  )
);
```

---

## 8. Риски

| Риск | Оценка | Митигация |
|------|--------|-----------|
| Осиротевшие free submissions (homework_id IS NULL после миграции) | Средний | Шаги 2-3 создают placeholders перед шагом 4 |
| Дублирование ДЗ для одной темы | Низкий | Проверка `NOT EXISTS` в шаге 2 |
| Поломка `upsert` в SubmitHomeworkModal | Низкий | onConflict: 'homework_id,student_id' уже корректен |
| TopicPage без ДЗ показывает пустую форму | Средний | Изменить UX: скрыть форму, показать "Задание не назначено" |
| Откат невозможен после шага 5 | Высокий | Сделать бэкап через `CREATE TABLE hw_subs_backup AS SELECT * FROM homework_submissions` |
| Учитель видит auto-created ДЗ которые не создавал | Низкий | Добавить поле `auto_created: bool` или `source: 'teacher'|'auto'` |

---

## 9. Порядок выполнения

```
1. [ ] Бэкап: CREATE TABLE hw_subs_backup AS SELECT * FROM homework_submissions;
2. [ ] SQL: Шаги 1-3 (добавить teacher_id, создать placeholders, связать)
3. [ ] Проверить: SELECT COUNT(*) WHERE homework_id IS NULL = 0
4. [ ] SQL: Шаг 4 (NOT NULL constraint + UNIQUE)
5. [ ] SQL: Шаг 5 (DROP COLUMN topic_id, group_id)
6. [ ] SQL: Шаг 6 (упростить RLS)
7. [ ] Код: useHomeworks.ts — один запрос
8. [ ] Код: useTeacherDashboard.ts — убрать topicSubsRes
9. [ ] Код: HomeworksPage.tsx — убрать вкладки
10. [ ] Код: TopicPage.tsx — убрать free-submission ветку
11. [ ] Код: ReviewTopicSubmissionModal.tsx — проверить/удалить
12. [ ] Тест: все роли, все сценарии
```
