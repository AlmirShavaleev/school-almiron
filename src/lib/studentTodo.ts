import { collapseToWorks, toQueueRows, type QueueRow } from '@/lib/homeworkQueue'
import { dueUrgency } from '@/lib/topicHomework'
import { isTopicOpen, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'

/**
 * Раскладка «что мне сдать» для кабинета ученика.
 *
 * Правила собраны отдельно от загрузки данных, чтобы их можно было проверить
 * без сети и без рендера. Ни одно правило здесь не изобретается заново:
 * состояние работы даёт `collapseToWorks` (§88), срочность — `dueUrgency`
 * (§91/§99, счёт по локальным календарным дням), открытость темы —
 * `isTopicOpen` (§59, зеркало `topic_open_now`). Своих условий не пишем: две
 * копии одного правила уже дважды расходились.
 */

/** ДЗ, доступное ученику: строка `topic_homework` вместе с темой. */
export interface TodoHomework {
  homeworkId:   string
  homeworkTitle: string
  topicId:      string
  topicTitle:   string
  courseId:     string
  courseTitle:  string
  /** Предмет курса: им красится метка курса в строке. Не название — §123. */
  courseSubject?: string | null
  groupId:      string | null
  dueAt:        string | null
  topic:        TopicOpenState
}

/** Выданное тестирование. */
export interface TodoTest {
  assignmentId: string
  testId:       string
  testTitle:    string
  topicId:      string
  topicTitle:   string
  completed:    boolean
}

/** Вердикт по работе — для раздела «Проверено». */
export interface TodoVerdict {
  attemptId:     string
  homeworkTitle: string
  decision:      'accepted' | 'returned_for_revision'
  score:         number | null
  gradeScale:    'five' | 'hundred' | null
  comment:       string | null
  createdAt:     string
}

export interface StudentTodoInput {
  /** Сырые попытки в том же виде, что и очередь проверки, — для `toQueueRows`. */
  rawAttempts: unknown[]
  /** Все доступные ученику ДЗ (опубликованные, по его курсам). */
  homework:    TodoHomework[]
  tests:       TodoTest[]
  verdicts:    TodoVerdict[]
  /** Сегодня как YYYY-MM-DD; параметр — чтобы тест не зависел от часов. */
  today?:      string
}

export interface TodoItem {
  key:           string
  homeworkId:    string
  title:         string
  topicTitle:    string
  courseTitle:   string
  courseSubject: string | null
  groupId:       string | null
  topicId:       string
  dueAt:         string | null
  /** Сколько дней до срока (минус — просрочка). */
  days:          number
  comment:       string | null
}

export interface StudentTodo {
  overdue:     TodoItem[]
  returned:    TodoItem[]
  dueSoon:     TodoItem[]
  /** Сдать надо, а срока нет. Отдельно от «сдать до»: сортировать нечем. */
  noDue:       TodoItem[]
  tests:       TodoTest[]
  newlyOpened: TodoTopic[]
  checked:     TodoVerdict[]
  /** Ничего не ждёт действий ученика. */
  isClear:     boolean
}

export interface TodoTopic {
  topicId:     string
  topicTitle:  string
  courseTitle: string
  courseSubject: string | null
  groupId:     string | null
  openedOn:    string | null
}

/** Темы, открывшиеся не раньше этого числа дней назад, считаются новыми. */
const NEWLY_OPENED_DAYS = 7

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((new Date(toDay).getTime() - new Date(fromDay).getTime()) / 86400000)
}

/**
 * Состояние работы по ДЗ: последняя попытка пары «ДЗ + ученик» либо её
 * отсутствие. Ключ — `homeworkId`, потому что ученик здесь всегда один.
 */
export function worksByHomework(rawAttempts: unknown[]): Map<string, QueueRow> {
  const works = collapseToWorks(toQueueRows(rawAttempts))
  const byHomework = new Map<string, QueueRow>()
  for (const work of works) byHomework.set(work.homeworkId, work)
  return byHomework
}

export function buildStudentTodo(input: StudentTodoInput): StudentTodo {
  const today = input.today ?? todayLocal()
  const works = worksByHomework(input.rawAttempts)

  const overdue:  TodoItem[] = []
  const returned: TodoItem[] = []
  const dueSoon:  TodoItem[] = []
  const noDue:    TodoItem[] = []

  for (const hw of input.homework) {
    // Закрытая тема — не дело ученика: сдать он туда всё равно не может.
    // Правило открытости берём из общего зеркала, а не пишем своё.
    if (!isTopicOpen(hw.topic, today)) continue

    const work = works.get(hw.homeworkId)
    const status = work?.attempt.status ?? null

    // Принятая работа закрыта окончательно — ни в одну корзину дел.
    if (status === 'accepted') continue

    const urgency = dueUrgency(hw.dueAt, today)
    const item: TodoItem = {
      key:         hw.homeworkId,
      homeworkId:  hw.homeworkId,
      title:       hw.homeworkTitle,
      topicTitle:  hw.topicTitle,
      courseTitle: hw.courseTitle,
      courseSubject: hw.courseSubject ?? null,
      groupId:     hw.groupId,
      topicId:     hw.topicId,
      dueAt:       hw.dueAt,
      days:        urgency.level === 'overdue' ? -urgency.days : urgency.days,
      comment:     null,
    }

    // Возврат на доработку важнее срока: работа ждёт именно ученика, и
    // показывать её в «сдать до» вместе с нетронутыми — терять главное.
    if (status === 'returned_for_revision') {
      returned.push(item)
      continue
    }

    // Отправленная и ещё не проверенная работа — не дело ученика: он своё
    // сделал. В просрочку она тоже не попадает, иначе сдавший вовремя видел
    // бы красное, пока преподаватель не дошёл до проверки.
    if (status === 'submitted') continue

    if (urgency.level === 'overdue') overdue.push(item)
    else if (hw.dueAt) dueSoon.push(item)
    // Работа без срока — тоже дело ученика. Раньше она не попадала никуда:
    // «сдать до» требует срока, и на дашборде такие работы не существовали,
    // хотя на странице ДЗ стояли в «Нужно сделать» (на проде их было 4 из 6).
    else noDue.push(item)
  }

  // Просроченные — от самых давних; «сдать до» — ближайшие сверху.
  overdue.sort((a, b) => a.days - b.days)
  dueSoon.sort((a, b) => a.days - b.days)
  returned.sort((a, b) => a.days - b.days)
  // Без срока сортировать нечем — берём курс и название, чтобы порядок был
  // устойчивым, а не зависел от того, как строки легли в ответе базы.
  noDue.sort((a, b) =>
    a.courseTitle.localeCompare(b.courseTitle, 'ru') || a.title.localeCompare(b.title, 'ru'))

  // Комментарий преподавателя к возвращённой работе — по последнему вердикту.
  const lastComment = new Map<string, string | null>()
  for (const verdict of input.verdicts) {
    if (verdict.decision !== 'returned_for_revision') continue
    const work = [...works.values()].find(w => w.attempt.id === verdict.attemptId)
    if (work) lastComment.set(work.homeworkId, verdict.comment)
  }
  for (const item of returned) {
    item.comment = lastComment.get(item.homeworkId) ?? null
  }

  const tests = input.tests.filter(test => !test.completed)

  const newlyOpened: TodoTopic[] = []
  const seenTopics = new Set<string>()
  for (const hw of input.homework) {
    if (seenTopics.has(hw.topicId)) continue
    if (!isTopicOpen(hw.topic, today)) continue
    const openedOn = hw.topic.available_from ? hw.topic.available_from.slice(0, 10) : null
    // «Недавно открылось» считаем только по дате открытия. Ручной тумблер
    // (`is_open = true`) времени переключения не хранит, и выдавать такие темы
    // за новые — врать: они могли быть открыты месяц назад.
    if (!openedOn) continue
    const age = daysBetween(openedOn, today)
    if (age < 0 || age > NEWLY_OPENED_DAYS) continue
    seenTopics.add(hw.topicId)
    newlyOpened.push({
      topicId:     hw.topicId,
      topicTitle:  hw.topicTitle,
      courseTitle: hw.courseTitle,
      courseSubject: hw.courseSubject ?? null,
      groupId:     hw.groupId,
      openedOn,
    })
  }

  const checked = [...input.verdicts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)

  return {
    overdue,
    returned,
    dueSoon,
    noDue,
    tests,
    newlyOpened,
    checked,
    // «Всё сдано» обязано учитывать и работы без срока: иначе экран говорил бы
    // «ничего не ждёт» поверх списка того, что надо сдать.
    isClear: overdue.length === 0 && returned.length === 0
          && dueSoon.length === 0 && noDue.length === 0 && tests.length === 0,
  }
}

/**
 * Срок словами: «завтра», «через 3 дня», «просрочено на 2 дня». Считается по
 * календарным дням — тем же счётом, что и `dueUrgency`.
 */
export function formatDueIn(days: number): string {
  if (days < 0) {
    const overdue = Math.abs(days)
    return `просрочено на ${overdue} ${pluralDays(overdue)}`
  }
  if (days === 0) return 'сегодня'
  if (days === 1) return 'завтра'
  return `через ${days} ${pluralDays(days)}`
}

function pluralDays(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 14) return 'дней'
  const ones = n % 10
  if (ones === 1) return 'день'
  if (ones >= 2 && ones <= 4) return 'дня'
  return 'дней'
}
