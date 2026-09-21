/**
 * Таблица проверки по заданиям — та, которую правит преподаватель (§199).
 *
 * Отличие от `aiHomeworkCheck.AiTaskRow` не в полях, а в смысле: там слепок
 * ответа модели (§180), неприкосновенный, потому что по нему сравнивают версии
 * ИИ-проверки; здесь — вердикт человека, который и есть результат проверки.
 * Поэтому две сущности, а не одна редактируемая: миграция `PENDING_199.sql`
 * объясняет это подробнее.
 *
 * Балл считается ТОЙ ЖЕ формулой, что у ИИ (`check-homework-ai/findings.ts`:
 * `computeScore`/`fiveFromRatio`). Копия здесь неизбежна — тот модуль живёт в
 * Deno-функции и в сборку клиента не входит, — но формула названа в одном
 * месте на клиент, и менять её нужно вместе с функцией.
 */

import type { AiTaskRow, AiTaskVerdict, AiTasksSummary } from './aiHomeworkCheck'
import type { GradeScale } from './topicHomework'

export type ReviewTaskVerdict = AiTaskVerdict

/** Строка таблицы проверки, как она лежит в `topic_homework_review_tasks`. */
export interface ReviewTaskRow {
  id: string
  attempt_id: string
  no: string
  verdict: ReviewTaskVerdict
  student_answer: string | null
  expected_answer: string | null
  note: string | null
  position: number
  updated_by: string | null
  updated_at: string
}

/**
 * Что можно править в строке. Номер здесь тоже: добавленную строку надо
 * назвать, а модель нумерует не всегда так, как в работе.
 */
export type ReviewTaskPatch = Partial<
  Pick<ReviewTaskRow, 'no' | 'verdict' | 'student_answer' | 'expected_answer' | 'note'>
>

export const REVIEW_TASK_VERDICTS: readonly ReviewTaskVerdict[] = [
  'correct',
  'wrong',
  'partial',
  'unchecked',
]

/**
 * Порядок строк — `position`, а при равных — номер задания по-человечески:
 * «2» перед «10», а не после, как вышло бы при сравнении строк. Сортировка на
 * клиенте, а не только в `order by`: строку добавляют и правят без перечитки
 * всей таблицы, и список обязан оставаться в том же порядке.
 */
export function sortReviewTasks(rows: readonly ReviewTaskRow[]): ReviewTaskRow[] {
  return [...rows].sort((a, b) => a.position - b.position || compareTaskNo(a.no, b.no))
}

/** «2» < «10» < «10a»: сначала число, потом хвост. */
export function compareTaskNo(a: string, b: string): number {
  const na = parseInt(String(a).replace(/[^\d]/g, ''), 10)
  const nb = parseInt(String(b).replace(/[^\d]/g, ''), 10)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return String(a).localeCompare(String(b), 'ru')
}

/** Сводка по вердиктам — она же объяснение балла. */
export function summarizeReviewTasks(rows: readonly { verdict: ReviewTaskVerdict }[]): AiTasksSummary {
  const summary: AiTasksSummary = { correct: 0, wrong: 0, partial: 0, unchecked: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return summary
}

/**
 * Пятибалльная шкала по доле верных: 5 от 90 %, 4 от 70 %, 3 от 50 %, ниже 2.
 * Зеркало `fiveFromRatio` из `findings.ts` — пороги названы числами, чтобы их
 * можно было проверить в уме (§180).
 */
export function fiveFromRatio(ratio: number): number {
  if (ratio >= 0.9) return 5
  if (ratio >= 0.7) return 4
  if (ratio >= 0.5) return 3
  return 2
}

export interface ReviewTaskScore {
  /** Заданий в знаменателе: всё, кроме `unchecked`. */
  counted: number
  /** Доля верных с учётом половинок; null — считать не по чему. */
  ratio: number | null
  /** Балл по шкале курса; null — таблицы нет, шкалы нет или всё не сверено. */
  score: number | null
}

/**
 * Балл из таблицы преподавателя: `(correct + 0,5·partial) / (всего −
 * unchecked)` → шкала. `unchecked` не считаются ни за, ни против.
 *
 * Пустая таблица и таблица из одних `unchecked` дают `null`, а не 0: ноль
 * вслепую хуже отсутствия балла (§149) — преподаватель должен поставить его
 * сам, а не согласиться с подстановкой.
 */
export function reviewTasksScore(
  rows: readonly { verdict: ReviewTaskVerdict }[],
  scale: GradeScale | null,
): ReviewTaskScore {
  const summary = summarizeReviewTasks(rows)
  const counted = summary.correct + summary.partial + summary.wrong
  if (counted === 0 || scale == null) return { counted, ratio: null, score: null }
  const ratio = (summary.correct + 0.5 * summary.partial) / counted
  const score = scale === 'five' ? fiveFromRatio(ratio) : Math.round(ratio * 100)
  return { counted, ratio, score }
}

/**
 * Номер для новой строки: следующее целое за самым большим в таблице.
 *
 * Модель могла пропустить задание или выдумать лишнее — строку добавляют и
 * удаляют руками, и номер по умолчанию должен попадать в то место, куда его
 * обычно и пишут: в конец. Уникальность держит база (`unique (attempt_id,
 * no)`), здесь только удобная подстановка.
 */
export function nextTaskNo(rows: readonly { no: string }[]): string {
  let max = 0
  for (const row of rows) {
    const n = parseInt(String(row.no).replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}

/** `position` для новой строки — в конец, с запасом на вставку между. */
export function nextPosition(rows: readonly { position: number }[]): number {
  let max = 0
  for (const row of rows) if (row.position > max) max = row.position
  return max + 10
}

/**
 * §207. Проверка ИИ новее таблицы преподавателя?
 *
 * Слепок модели не перезаписывает таблицу (§199) — иначе свежий прогон затирал
 * бы правки человека. Но тогда на экране жили два ряда счётчиков, которые
 * спорили друг с другом: «верно 13» по таблице и «верно 17» по последнему
 * прогону. Счётчик оставлен один, табличный, а вот молчать про устаревшую
 * таблицу нельзя — иначе преподаватель сдаст работу по позапрошлому разбору,
 * не узнав, что есть новый.
 *
 * Сравниваем по времени: конец прогона против самой свежей правки строки.
 * Таблица, только что собранная из этого прогона, новее его — и строка не
 * появится, что и требуется.
 */
export function aiCheckIsNewerThanTable(
  job: { status: string; completed_at: string | null } | null | undefined,
  rows: readonly { updated_at: string }[],
): boolean {
  if (!job || job.status !== 'done' || !job.completed_at) return false
  if (rows.length === 0) return false
  const done = Date.parse(job.completed_at)
  if (!Number.isFinite(done)) return false
  let newest = -Infinity
  for (const row of rows) {
    const at = Date.parse(row.updated_at)
    if (Number.isFinite(at) && at > newest) newest = at
  }
  if (newest === -Infinity) return false
  return done > newest
}

/**
 * §212. Что показывает таблица: всё или одно состояние.
 *
 * Пришло на смену двум свёрткам §207 (пачка верных и пачка одинаковых «не
 * сверено»). Свёртки решали ту же задачу — убрать с глаз то, что сейчас не
 * смотрят, — но своим способом: механик стало две, обе с памятью состояния,
 * и строка могла спрятаться прямо под курсором. Фильтр делает ту же работу
 * одной механикой, и она же отвечает на обратный вопрос («покажи только
 * неверные»), на который свёртка ответить не умела.
 */
export type ReviewTaskFilter = ReviewTaskVerdict | 'all'

/** Строки, которые видны при этом фильтре. */
export function filterReviewTasks<Row extends { verdict: ReviewTaskVerdict }>(
  rows: readonly Row[],
  filter: ReviewTaskFilter,
): Row[] {
  if (filter === 'all') return [...rows]
  return rows.filter(row => row.verdict === filter)
}

/**
 * Нажали на счётчик. Повторное нажатие по включённому снимает фильтр: иначе
 * выйти из «только неверные» можно было бы лишь через «все», и кнопка,
 * которую только что нажали, ничего бы не делала.
 */
export function toggleReviewTaskFilter(
  current: ReviewTaskFilter,
  clicked: ReviewTaskFilter,
): ReviewTaskFilter {
  if (clicked === 'all') return 'all'
  return current === clicked ? 'all' : clicked
}

/**
 * Строки для новой таблицы из слепка ИИ — на случай, когда заполняет клиент,
 * а не RPC (в приложении заполняет RPC; здесь — чтобы правило «что именно
 * копируется» было названо один раз и проверялось тестом).
 */
export function reviewTasksFromAi(tasks: readonly AiTaskRow[]): Array<Omit<ReviewTaskRow, 'id' | 'attempt_id' | 'updated_by' | 'updated_at'>> {
  return tasks.map((task, index) => ({
    no: task.no,
    verdict: task.verdict,
    student_answer: task.student_answer || null,
    expected_answer: task.expected_answer || null,
    note: task.note || null,
    position: (index + 1) * 10,
  }))
}
