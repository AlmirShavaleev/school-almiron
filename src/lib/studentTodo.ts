import { collapseToWorks, toQueueRows, type QueueRow } from '@/lib/homeworkQueue'
import { dueUrgency } from '@/lib/topicHomework'
import { isTopicOpen, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'
import { plural } from '@/lib/plural'

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
  /** Группа курса темы — для ссылки на тему (§254). Нет — строка без ссылки. */
  groupId?:     string | null
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
  /** ДЗ этой работы: по нему страница ДЗ открывает «Новые оценки» (§254). */
  homeworkId?:   string
  /** Тема работы — подпись кнопки «Новые оценки»: название ДЗ часто «Домашнее задание». */
  topicTitle?:   string
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
  /**
   * §254. «Новые оценки»: работа ПРИНЯТА (последний вердикт по попытке) не
   * раньше NEW_GRADES_DAYS дней назад. Свежие сверху.
   */
  newGrades:   TodoVerdict[]
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

/**
 * §254. Окно кнопки «Сдать за 2 недели»: срок через 0…14 календарных дней.
 * Всё, что дальше, — «Сдать позже» (кнопкой, только когда окно пусто).
 */
export const SOON_WINDOW_DAYS = 14

/**
 * §254. «Новые оценки» — принятые работы за последние 7 дней. Не «с последнего
 * просмотра»: отметки «видел» у вердиктов нет, а прочитанность уведомления
 * зависит от того, открывал ли ученик колокольчик и включены ли у него
 * уведомления, — счёт прыгал бы от постороннего действия.
 */
export const NEW_GRADES_DAYS = 7

/** Календарный день YYYY-MM-DD момента времени — по часам устройства, как `todayLocal`. */
function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA')
}

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

  const sortedVerdicts = [...input.verdicts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const checked = sortedVerdicts.slice(0, 5)

  // Последний вердикт по каждой попытке; принятые за NEW_GRADES_DAYS дней.
  const lastByAttempt = new Set<string>()
  const newGrades: TodoVerdict[] = []
  for (const verdict of sortedVerdicts) {
    if (lastByAttempt.has(verdict.attemptId)) continue
    lastByAttempt.add(verdict.attemptId)
    if (verdict.decision !== 'accepted') continue
    const age = daysBetween(localDay(verdict.createdAt), today)
    if (age < 0 || age > NEW_GRADES_DAYS) continue
    newGrades.push(verdict)
  }

  return {
    overdue,
    returned,
    dueSoon,
    noDue,
    tests,
    newlyOpened,
    checked,
    newGrades,
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

// ── §254. Кнопки-счётчики главной и отбор страницы ДЗ ───────────────────────
//
// Одно определение на обе стороны: кнопка главной считает ровно то, что
// страница «Домашние задания» покажет по её ссылке (`?show=…`). Корзины — те
// же, что выше (`overdue`/`returned`/`dueSoon`/`noDue`/`newGrades`); новых
// правил «просрочено/срок» здесь нет, только окно в 14 дней поверх `dueSoon`.

/** Какой список открывает ссылка `/my-homework?show=…`. */
export type HomeworkShow = 'overdue' | 'returned' | 'soon' | 'later' | 'checked' | 'nodue'

export const HOMEWORK_SHOW_VALUES: readonly HomeworkShow[] =
  ['overdue', 'returned', 'soon', 'later', 'checked', 'nodue'] as const

export function parseHomeworkShow(value: string | null | undefined): HomeworkShow | null {
  return HOMEWORK_SHOW_VALUES.includes(value as HomeworkShow) ? (value as HomeworkShow) : null
}

/** «Сдать за 2 недели» и «позже»: `dueSoon`, разрезанный окном SOON_WINDOW_DAYS. */
export function splitDueWindow(todo: Pick<StudentTodo, 'dueSoon'>): { soon: TodoItem[]; later: TodoItem[] } {
  return {
    soon:  todo.dueSoon.filter(item => item.days <= SOON_WINDOW_DAYS),
    later: todo.dueSoon.filter(item => item.days > SOON_WINDOW_DAYS),
  }
}

/** ДЗ списка `show` — в том порядке, в каком их показывает страница. */
export function homeworkIdsFor(todo: StudentTodo, show: HomeworkShow): string[] {
  const window = splitDueWindow(todo)
  switch (show) {
    case 'overdue':  return todo.overdue.map(i => i.homeworkId)
    case 'returned': return todo.returned.map(i => i.homeworkId)
    case 'soon':     return window.soon.map(i => i.homeworkId)
    case 'later':    return window.later.map(i => i.homeworkId)
    case 'nodue':    return todo.noDue.map(i => i.homeworkId)
    case 'checked':  return todo.newGrades.map(v => v.homeworkId).filter((id): id is string => !!id)
  }
}

/** Заголовок списка — один на кнопку и на страницу ДЗ. */
export const HOMEWORK_SHOW_TITLE: Record<HomeworkShow, string> = {
  overdue:  'Просрочено',
  returned: 'Вернули на доработку',
  soon:     'Сдать за 2 недели',
  later:    'Сдать позже',
  checked:  'Новые оценки',
  nodue:    'Без срока',
}

export type HomeActionTone = 'bad' | 'warn' | 'soon' | 'ok'

export interface HomeAction {
  show:    HomeworkShow
  count:   number
  title:   string
  caption: string
  tone:    HomeActionTone
  href:    string
}

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «14 ноября» по дате YYYY-MM-DD — без часового пояса: это календарный день. */
export function formatDayMonth(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS_GENITIVE[m - 1]}`
}

function quoted(title: string, more: number): string {
  return `«${title}»${more > 0 ? ` и ещё ${more}` : ''}`
}

/** Оценка словами для подписи: «4/5», «87/100», без шкалы — «принято». */
export function verdictMark(verdict: Pick<TodoVerdict, 'score' | 'gradeScale'>): string {
  const max = verdict.gradeScale === 'five' ? 5 : verdict.gradeScale === 'hundred' ? 100 : null
  if (verdict.score == null) return 'принято'
  return max ? `${verdict.score}/${max}` : String(verdict.score)
}

/**
 * Кнопки-счётчики главной (§254), по важности: просрочено → вернули →
 * сдать за 2 недели (или «позже», если окно пусто) → новые оценки. Кнопка с
 * нулём не рождается вовсе.
 */
export function homeActions(todo: StudentTodo): HomeAction[] {
  const out: HomeAction[] = []
  const href = (show: HomeworkShow) => `/my-homework?show=${show}`

  if (todo.overdue.length > 0) {
    // Список отсортирован «самое давнее сверху» — первое и есть самое давнее.
    const oldest = Math.abs(todo.overdue[0].days)
    out.push({
      show: 'overdue', count: todo.overdue.length, title: HOMEWORK_SHOW_TITLE.overdue, tone: 'bad', href: href('overdue'),
      caption: `самое давнее — ${oldest} ${plural(oldest, 'день', 'дня', 'дней')}`,
    })
  }

  if (todo.returned.length > 0) {
    out.push({
      show: 'returned', count: todo.returned.length, title: HOMEWORK_SHOW_TITLE.returned, tone: 'warn', href: href('returned'),
      caption: quoted(todo.returned[0].topicTitle, todo.returned.length - 1),
    })
  }

  const { soon, later } = splitDueWindow(todo)
  if (soon.length > 0) {
    const nearest = soon[0].days
    out.push({
      show: 'soon', count: soon.length, title: HOMEWORK_SHOW_TITLE.soon, tone: 'soon', href: href('soon'),
      caption: `ближайшее — ${formatDueIn(nearest)}`,
    })
  } else if (later.length > 0) {
    out.push({
      show: 'later', count: later.length, title: HOMEWORK_SHOW_TITLE.later, tone: 'soon', href: href('later'),
      caption: `ближайшее — ${later[0].dueAt ? formatDayMonth(later[0].dueAt) : formatDueIn(later[0].days)}`,
    })
  }

  if (todo.newGrades.length > 0) {
    const last = todo.newGrades[0]
    out.push({
      show: 'checked', count: todo.newGrades.length, title: HOMEWORK_SHOW_TITLE.checked, tone: 'ok', href: href('checked'),
      caption: `«${last.topicTitle || last.homeworkTitle}» — ${verdictMark(last)}`,
    })
  }

  return out
}
