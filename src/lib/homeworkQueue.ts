/**
 * Чистые помощники общей очереди проверки ДЗ.
 *
 * Очередь — это все сданные (`submitted`) попытки по всем темам курсов
 * преподавателя. Кто именно видит попытки, решает RLS (те же политики, что
 * кормят проверку внутри темы); здесь только формирование и порядок списка.
 */
import type {
  TopicHomeworkAttemptRow, TopicHomeworkAttemptStatus, TopicHomeworkReviewRow,
} from '@/lib/topicHomework'
import { plural } from '@/lib/plural'

/**
 * Вкладки страницы проверки. Ровно три состояния попытки, которые видит
 * преподаватель: `draft` сюда не попадает — работа ещё у ученика.
 *
 * Порядок — рабочий: сначала то, что требует действия, потом то, что ждёт
 * ученика, и в конце закрытое.
 */
export type QueueTab = 'submitted' | 'returned_for_revision' | 'accepted'

export const QUEUE_TABS: ReadonlyArray<{ key: QueueTab; label: string }> = [
  { key: 'submitted', label: 'Ждут проверки' },
  { key: 'returned_for_revision', label: 'На доработке' },
  { key: 'accepted', label: 'Принятые' },
]

/** Статусы, которые страница вообще грузит: одним запросом на все вкладки. */
export const QUEUE_STATUSES: QueueTab[] = QUEUE_TABS.map(t => t.key)

/**
 * Статусы, которые запрашивает очередь проверки. Черновик ни на одной вкладке
 * не показывается и ни в один счётчик не входит — он нужен только как ответ на
 * вопрос «не начал ли ученик новую попытку».
 *
 * §198: возвращённую работу теперь можно принять как есть, но только если она
 * последняя. Признак «есть попытка новее» без черновиков не получить: пока
 * ученик собирает новую попытку, она в статусе `draft`, и очередь её не видела
 * вовсе — преподаватель нажал бы «Принять» и получил отказ базы.
 */
export const QUEUE_LOADED_STATUSES: TopicHomeworkAttemptStatus[] = ['draft', ...QUEUE_STATUSES]

/** Строка очереди: попытка + контекст (ДЗ → тема → курс), пришедший из join'а. */
export interface QueueRow {
  attempt: TopicHomeworkAttemptRow
  /**
   * Предыдущие попытки той же работы, от новой к старой.
   *
   * Строка очереди — это РАБОТА (пара «ДЗ + ученик»), а не попытка. Цикл
   * «сдал → вернули → пересдал → приняли» даёт две строки в
   * `topic_homework_attempts`, и до §83 работа висела на двух вкладках разом:
   * на «На доработке» — первой попыткой, на «Принятых» — второй. Старые
   * попытки живут здесь как история, а не как отдельные строки списка.
   */
  history: TopicHomeworkAttemptRow[]
  /**
   * Попытка НОВЕЕ показанной, если она есть (§198). На практике это черновик:
   * сданную или проверенную новую попытку `collapseToWorks` сам выбрал бы
   * состоянием работы.
   *
   * Поле необязательное: его заполняет только `buildQueueWorks`, а кабинет
   * ученика и карточка ученика собирают работы прежним `collapseToWorks` и о
   * черновиках соседних попыток ничего не знают.
   */
  newerAttempt?: TopicHomeworkAttemptRow | null
  homeworkId: string
  homeworkTitle: string
  gradeScale: 'five' | 'hundred' | null
  /** Срок сдачи ДЗ — нужен, чтобы отметить в списке опоздавших. */
  dueAt: string | null
  topicId: string
  topicTitle: string
  courseId: string
  courseTitle: string
}

/**
 * Работу уже проверил кто-то другой.
 *
 * `topic_homework_review_attempt` пускает вердикт только к попытке в статусе
 * `submitted` или `returned_for_revision` (§198) и, не найдя строки, падает.
 * Это и есть защита от двойного вердикта: второй проверяющий не перезапишет
 * решение первого. Опознаём случай по тексту, потому что своего кода ошибки у
 * него нет — а отличать его надо, иначе преподаватель получит непонятную
 * техническую фразу вместо объяснения.
 *
 * Текстов два, и оба из RPC: «Попытка не в статусе «сдано»» (черновик) и
 * «Работа уже принята…» (пока мы считали балл, коллега принял работу).
 * Принятая — единственное состояние, из которого вердикт больше не ставится:
 * возврат на доработку с §198 пересматривается.
 */
export function isAlreadyReviewedError(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')
  return message.includes('не в статусе') || message.includes('уже принята')
}

/**
 * Сдано ли позже срока. Сравниваем именно момент СДАЧИ с дедлайном, а не
 * «сейчас» с дедлайном: работа уже сдана, и для преподавателя важно, опоздал
 * ли ученик, а не сколько времени прошло с тех пор.
 */
export function isSubmittedLate(row: QueueRow): boolean {
  const { dueAt } = row
  const submittedAt = row.attempt.submitted_at
  if (!dueAt || !submittedAt) return false
  return new Date(submittedAt).getTime() > new Date(dueAt).getTime()
}

/**
 * Разворачивает ответ PostgREST с вложенными join'ами в плоскую строку.
 * Строки с неполным контекстом (оборванный join) отбрасываются, чтобы одна
 * битая запись не роняла всю очередь.
 */
export function toQueueRows(raw: unknown[]): QueueRow[] {
  const rows: QueueRow[] = []
  for (const item of raw as any[]) {
    const hw = item?.homework
    const topic = hw?.topic
    const course = topic?.module?.course
    if (!hw?.id || !topic?.id || !course?.id) continue
    const { homework: _hw, ...attempt } = item
    rows.push({
      attempt: attempt as TopicHomeworkAttemptRow,
      history: [],
      homeworkId: hw.id,
      homeworkTitle: hw.title ?? 'Домашнее задание',
      gradeScale: hw.grade_scale ?? null,
      dueAt: hw.due_at ?? null,
      topicId: topic.id,
      topicTitle: topic.title ?? 'Тема',
      courseId: course.id,
      courseTitle: course.title ?? 'Курс',
    })
  }
  return rows
}

/** Ключ работы: одна и та же пара «ДЗ + ученик» — одна строка списка. */
export function workKey(row: QueueRow): string {
  return `${row.homeworkId}:${row.attempt.student_id}`
}

/**
 * Схлопывает попытки в РАБОТЫ: одна строка на пару «ДЗ + ученик», состояние —
 * состояние ПОСЛЕДНЕЙ попытки, остальные уходят в `history`.
 *
 * Это единственное место, где решается «в каком состоянии работа». Вкладки и
 * счётчики считают уже по схлопнутому списку — второй копии правила нет
 * сознательно: ровно рассинхрон копий породил §21 и §29, а до §83 счётчики
 * вкладок показывали 3/6/9 по попыткам, хотя работ было 12 и шесть из них
 * висели сразу на двух вкладках.
 *
 * Последняя — по `attempt_number`: его ведёт база (частичные UNIQUE-индексы
 * и триггер `topic_homework_attempts_guard`), а `submitted_at` у черновика
 * может быть пустым и на роль порядка не годится.
 */
export function collapseToWorks(rows: QueueRow[]): QueueRow[] {
  const byWork = new Map<string, QueueRow[]>()
  for (const row of rows) {
    const key = workKey(row)
    const list = byWork.get(key)
    if (list) list.push(row)
    else byWork.set(key, [row])
  }

  const out: QueueRow[] = []
  for (const list of byWork.values()) {
    const sorted = [...list].sort((a, b) => b.attempt.attempt_number - a.attempt.attempt_number)
    const [latest, ...older] = sorted
    out.push({ ...latest, history: older.map(r => r.attempt) })
  }
  return out
}

/**
 * Работы очереди проверки из ВСЕГО загруженного: то же схлопывание, что и
 * раньше, плюс отметка «у работы есть попытка новее показанной».
 *
 * Черновики в список не попадают — ни строкой, ни состоянием работы. Иначе
 * работа, возвращённая на доработку, исчезала бы с вкладки «На доработке» в
 * ту секунду, когда ученик начал новую попытку: именно там преподаватель её и
 * ищет, чтобы принять как есть (§198).
 *
 * Отдельная функция, а не правка `collapseToWorks`: тем же схлопыванием живут
 * кабинет ученика (`studentTodo`) и карточка ученика (`useStudentInsights`), и
 * там черновик — законное состояние работы («ещё не сдал»).
 */
export function buildQueueWorks(rows: QueueRow[]): QueueRow[] {
  const works = collapseToWorks(rows.filter(r => r.attempt.status !== 'draft'))
  const drafts = rows.filter(r => r.attempt.status === 'draft')
  if (drafts.length === 0) return works

  const newestDraft = new Map<string, TopicHomeworkAttemptRow>()
  for (const row of drafts) {
    const key = workKey(row)
    const known = newestDraft.get(key)
    if (!known || row.attempt.attempt_number > known.attempt_number) {
      newestDraft.set(key, row.attempt)
    }
  }

  return works.map(work => {
    const draft = newestDraft.get(workKey(work))
    return draft && draft.attempt_number > work.attempt.attempt_number
      ? { ...work, newerAttempt: draft }
      : work
  })
}

/**
 * Что показывать в блоке вердикта.
 *
 * - `form` — работа ждёт решения, обычная форма;
 * - `revise` — работа возвращена на доработку, но она последняя: принять как
 *   есть можно (§198), и об этом нужно сказать прямо;
 * - `blocked` — у работы есть попытка новее: вердикт этой попытке база не
 *   примет, кнопки должны быть выключены, а не «нажмите и получите ошибку»;
 * - `summary` — принято, решение больше не меняется.
 *
 * Правило одно и то же, что в `topic_homework_review_attempt`: исходные
 * статусы `submitted` и `returned_for_revision`, и только последняя попытка.
 * Это UX, а не защита — отказ всё равно держит база.
 */
export type VerdictAccess = 'form' | 'revise' | 'blocked' | 'summary'

export function verdictAccess(row: QueueRow): VerdictAccess {
  const { status } = row.attempt
  if (status !== 'submitted' && status !== 'returned_for_revision') return 'summary'
  if (row.newerAttempt) return 'blocked'
  return status === 'submitted' ? 'form' : 'revise'
}

/** Почему вердикт недоступен — текст для преподавателя, или `null`. */
export function newerAttemptReason(row: QueueRow): string | null {
  const newer = row.newerAttempt
  if (!newer) return null
  return newer.status === 'draft'
    ? `Ученик уже начал новую попытку (№${newer.attempt_number}) — эту принимать нельзя`
    : `Ученик сдал работу заново — откройте последнюю попытку (№${newer.attempt_number})`
}

/**
 * Одна строка про путь работы: «возвращена 4 августа, принята 5 августа».
 *
 * Нужна там, где вердикт уже стоит: с §198 у ОДНОЙ попытки может быть
 * несколько вердиктов, и последний («принято») сам по себе врёт о том, что
 * было. `null`, если вердикт всего один — тогда его и так видно.
 */
export function verdictTrail(reviews: TopicHomeworkReviewRow[], attemptId: string): string | null {
  const own = reviews
    .filter(r => r.attempt_id === attemptId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (own.length < 2) return null
  return own
    .map(r => {
      const when = new Date(r.created_at)
      const day = Number.isNaN(when.getTime())
        ? null
        : when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      const what = r.decision === 'accepted' ? 'принята' : 'возвращена'
      return day ? `${what} ${day}` : what
    })
    .join(', ')
}

/** Строки одной вкладки. Порядок не трогаем — он задан `sortQueue`. */
export function rowsOfTab(rows: QueueRow[], tab: QueueTab): QueueRow[] {
  return rows.filter(r => r.attempt.status === tab)
}

/**
 * Счётчики вкладок. Считаются по ВСЕМ загруженным строкам, а не по видимым:
 * число на вкладке должно отвечать на вопрос «сколько там всего», иначе
 * фильтр по курсу обнулял бы соседнюю вкладку и она выглядела бы пустой.
 */
export function countByTab(rows: QueueRow[]): Record<QueueTab, number> {
  const counts: Record<QueueTab, number> = {
    submitted: 0, returned_for_revision: 0, accepted: 0,
  }
  for (const row of rows) {
    const status = row.attempt.status
    if (status in counts) counts[status as QueueTab] += 1
  }
  return counts
}

/**
 * Порядок очереди: кто дольше ждёт — тот выше. Так преподаватель разгребает
 * хвост честно, а не только свежие сдачи.
 */
export function sortQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) =>
    (a.attempt.submitted_at ?? '').localeCompare(b.attempt.submitted_at ?? ''),
  )
}

/**
 * Группировка по дню сдачи.
 *
 * День берём по локальному времени преподавателя, а не по UTC: работа, сданная
 * в 23:30 по Москве, для него сдана сегодня, и в списке она должна стоять под
 * сегодняшним числом. Ключ — YYYY-MM-DD из локальных частей даты, потому что
 * `toISOString()` пересчитал бы в UTC и увёл вечерние сдачи в следующий день.
 */
export function groupByDay(rows: QueueRow[]): Array<{ dayKey: string; label: string; rows: QueueRow[] }> {
  const groups = new Map<string, { dayKey: string; label: string; rows: QueueRow[] }>()
  for (const row of rows) {
    const raw = row.attempt.submitted_at
    const date = raw ? new Date(raw) : null
    const valid = date && !Number.isNaN(date.getTime())
    const dayKey = valid ? localDayKey(date) : 'unknown'
    const label = valid
      ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Без даты сдачи'
    const g = groups.get(dayKey) ?? { dayKey, label, rows: [] }
    g.rows.push(row)
    groups.set(dayKey, g)
  }
  return Array.from(groups.values())
}

function localDayKey(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * Курсы, встречающиеся в очереди, со счётчиком работ. Именно из очереди, а не
 * из всего списка курсов: выпадающий список, где половина пунктов ничего не
 * фильтрует, только мешает.
 */
export function courseFilterOptions(rows: QueueRow[]): Array<{ id: string; title: string; count: number }> {
  const map = new Map<string, { id: string; title: string; count: number }>()
  for (const row of rows) {
    const item = map.get(row.courseId) ?? { id: row.courseId, title: row.courseTitle, count: 0 }
    item.count += 1
    map.set(row.courseId, item)
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

/**
 * Темы, встречающиеся в очереди, со счётчиком работ — по той же логике, что и
 * курсы: только из строк очереди, а не из справочника тем. Тема без сданных
 * работ в списке не появляется. При выбранном курсе — только его темы, иначе
 * преподаватель выберет тему чужого курса и получит пустой экран. §149.
 */
export function topicFilterOptions(
  rows: QueueRow[],
  courseId: string = 'all',
): Array<{ id: string; title: string; count: number }> {
  const map = new Map<string, { id: string; title: string; count: number }>()
  for (const row of rows) {
    if (courseId !== 'all' && row.courseId !== courseId) continue
    const item = map.get(row.topicId) ?? { id: row.topicId, title: row.topicTitle, count: 0 }
    item.count += 1
    map.set(row.topicId, item)
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

/** Группировка по курсу для заголовков секций; порядок внутри — как в очереди. */
export function groupByCourse(rows: QueueRow[]): Array<{ courseId: string; courseTitle: string; rows: QueueRow[] }> {
  const groups = new Map<string, { courseId: string; courseTitle: string; rows: QueueRow[] }>()
  for (const row of rows) {
    const g = groups.get(row.courseId) ?? { courseId: row.courseId, courseTitle: row.courseTitle, rows: [] }
    g.rows.push(row)
    groups.set(row.courseId, g)
  }
  return Array.from(groups.values())
}

/**
 * §226. Где открытая работа стоит в списке, который видит преподаватель:
 * «1 из 39». `null` — работы в этом списке нет (открыта по ссылке с другой
 * вкладки или отсеяна фильтром): номер «из» тогда был бы выдумкой.
 */
export function queuePosition(
  rows: readonly QueueRow[],
  attemptId: string,
): { index: number; total: number } | null {
  const index = rows.findIndex(row => row.attempt.id === attemptId)
  if (index < 0) return null
  return { index: index + 1, total: rows.length }
}

/**
 * §226. «Следующая работа» — следующая НЕПРОВЕРЕННАЯ (`submitted`) в том же
 * видимом списке после открытой; дошли до конца — с начала списка (пропущенные
 * раньше работы так и ждут). Себя не предлагаем. Открытой работы в списке нет
 * — `null`: «следующая» от места, которого нет, была бы догадкой.
 */
export function nextPendingRow(rows: readonly QueueRow[], attemptId: string): QueueRow | null {
  const at = rows.findIndex(row => row.attempt.id === attemptId)
  if (at < 0) return null
  const order = [...rows.slice(at + 1), ...rows.slice(0, at)]
  return order.find(row => row.attempt.status === 'submitted') ?? null
}

/**
 * §226. Строка под именем в шапке проверки: «Кинематика · Физика 11А · сдано
 * 22 сентября в 11:05, в срок · 2 фото». Всё, что преподаватель читает один
 * раз: где работа, когда сдана, успел ли ученик и сколько листов смотреть.
 * «в срок» — только когда срок есть: без срока «вовремя» было бы выдумкой.
 */
export function reviewHeaderMeta(
  row: QueueRow,
  files: readonly { mime_type: string | null; file_name: string }[],
): string {
  const parts: string[] = []
  if (row.topicTitle && row.topicTitle !== row.homeworkTitle) parts.push(row.topicTitle)
  if (row.courseTitle) parts.push(row.courseTitle)
  if (row.attempt.attempt_number > 1) parts.push(`попытка №${row.attempt.attempt_number}`)
  const submitted = row.attempt.submitted_at ? new Date(row.attempt.submitted_at) : null
  if (submitted && !Number.isNaN(submitted.getTime())) {
    const day = submitted.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    const time = submitted.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const when = isSubmittedLate(row) ? ', с опозданием' : row.dueAt ? ', в срок' : ''
    parts.push(`сдано ${day} в ${time}${when}`)
  }
  if (files.length > 0) {
    const photos = files.every(f => (f.mime_type ?? '').startsWith('image/'))
    parts.push(photos
      ? `${files.length} фото`
      : `${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`)
  }
  return parts.join(' · ')
}
