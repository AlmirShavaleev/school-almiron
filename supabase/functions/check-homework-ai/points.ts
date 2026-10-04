/**
 * Сумма баллов и оценка по критериям учителя (§260).
 *
 * Чистый модуль без Deno-API — как `findings.ts` и `reference.ts`: его гоняет
 * vitest из `src/`.
 *
 * Зачем. Проверочная 10А «Движение по окружности» (03.10): критерии учителя
 * дают баллы по заданиям («1–5 по 1 баллу, 6 — 2, 7 — 2, 8 — 3») и таблицу
 * перевода («11–12 → 5, 8–10 → 4, 5–7 → 3, 0–4 → 2»). А балл считал
 * `computeScore` — доля верных заданий с порогами 90/70/50 %, без весов и без
 * таблицы. Из 11 работ у двоих оценка вышла не та: 7 из 12 → «4» вместо «3»,
 * 9 из 12 → «3» вместо «4».
 *
 * Что теперь. Модель по каждому заданию ставит `points`/`max_points` по
 * критериям и отдельно переписывает из критериев таблицу перевода
 * (`grade_table`) и максимум (`max_total`). Складывает и переводит в оценку
 * КОД — здесь. Модели не доверяем ни сумму, ни оценку: §180 показал, что её
 * число не следует из её же таблицы.
 *
 * Сверка — главное. Критерии приходят распознаванием PDF, и прочитаны они
 * могут быть не целиком: выпала строка с заданием — сумма максимумов меньше
 * 12, таблица «съехала» — дыра между 7 и 8. Оценка по такой таблице выглядит
 * как настоящая и будет принята не глядя. Поэтому при любом расхождении оценка
 * не подставляется вовсе (`criteria_mismatch`), а учитель видит «Проверьте
 * баллы: критерии прочитаны не полностью».
 */

import { fiveFromRatio, parsePoints, type GradeScale, type TaskRow } from './findings.ts'

/** Строка таблицы перевода: сумма баллов от `min` до `max` включительно → оценка. */
export interface GradeTableRow {
  min: number
  max: number
  grade: number
}

/**
 * Как получена оценка (`topic_homework_ai_jobs.grading`):
 *  — `criteria` — по таблице перевода из критериев, сверка сошлась;
 *  — `ratio` — баллы по критериям есть, таблицы нет: доля баллов → прежние
 *    пороги 90/70/50 % (`fiveFromRatio`);
 *  — `criteria_mismatch` — сверка не сошлась, оценки нет.
 * `null` — баллов по критериям нет вовсе (обычное ДЗ), балл прежний.
 */
export type Grading = 'criteria' | 'ratio' | 'criteria_mismatch'

export interface CriteriaGrade {
  grading: Grading | null
  /** Сумма баллов по сверенным заданиям; null — баллов нет. */
  total: number | null
  /** Сумма максимумов по всем заданиям с баллами. */
  max: number | null
  /** Оценка по шкале курса; null — не выводится (расхождение, несверенные задания). */
  score: number | null
  /** Таблица перевода, как её прочитал код (по возрастанию `min`); null — её нет. */
  gradeTable: GradeTableRow[] | null
  /** Что не сошлось — словами, для summary; null — всё сошлось. */
  problem: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const LIST_LIMIT = 6

function listNos(nos: readonly string[]): string {
  return nos.length > LIST_LIMIT ? `${nos.slice(0, LIST_LIMIT).join(', ')} …` : nos.join(', ')
}

// ---------------------------------------------------------------------------
// Таблица перевода
// ---------------------------------------------------------------------------

export interface ParsedGradeTable {
  rows: GradeTableRow[]
  /** Хоть одна строка кривая (не числа, min > max, дробные границы, оценка не 1–5). */
  broken: boolean
}

/** Целое из ответа модели: 8, "8", "8.0"; иначе null. */
function intOf(raw: unknown): number | null {
  const n = parsePoints(raw)
  return n != null && Number.isInteger(n) ? n : null
}

/**
 * Таблица перевода из ответа модели. Пусто, не массив, `[]` — таблицы нет
 * (`null`): в критериях её может и не быть. Кривая строка не выбрасывается
 * молча, а ломает таблицу (`broken`): выбросить строку — значит самим сделать
 * дыру, которую потом честно найдёт сверка, но причину назовёт неверно.
 *
 * Принимаем `{min, max, grade}` и запасные имена (`from`/`to`, `mark`) —
 * модели пишут как привыкли.
 */
export function parseGradeTable(raw: unknown): ParsedGradeTable | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const rows: GradeTableRow[] = []
  let broken = false
  for (const item of raw) {
    if (!item || typeof item !== 'object') { broken = true; continue }
    const r = item as Record<string, unknown>
    const min = intOf(r.min ?? r.from)
    const max = intOf(r.max ?? r.to)
    const grade = intOf(r.grade ?? r.mark)
    if (min == null || max == null || grade == null || min > max || grade < 1 || grade > 5) {
      broken = true
      continue
    }
    rows.push({ min, max, grade })
  }
  rows.sort((a, b) => a.min - b.min || a.max - b.max)
  return { rows, broken }
}

/**
 * Сверка таблицы с суммой максимумов: покрывает 0..max ровно, без дыр и
 * пересечений, оценки не убывают с баллами. Возвращает причину словами или
 * null, если таблица годна.
 */
export function checkGradeTable(rows: readonly GradeTableRow[], max: number): string | null {
  if (rows.length === 0) return 'таблица перевода прочитана с ошибкой'
  if (rows[0].min !== 0) return `таблица перевода начинается с ${rows[0].min}, а не с 0`
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]
    const cur = rows[i]
    if (cur.min <= prev.max) return `в таблице перевода пересекаются строки ${prev.min}–${prev.max} и ${cur.min}–${cur.max}`
    if (cur.min > prev.max + 1) return `в таблице перевода пропущены баллы ${prev.max + 1}–${cur.min - 1}`
    if (cur.grade < prev.grade) return 'в таблице перевода оценки идут не по порядку'
  }
  const top = rows[rows.length - 1].max
  if (top !== max) return `таблица перевода доходит до ${top}, а сумма максимумов по заданиям — ${max}`
  return null
}

/**
 * Оценка по таблице. Дробная сумма (критерий дал «0,5») берётся по строке,
 * чью нижнюю границу она УЖЕ перешла: 7,5 — это ещё «5–7», до «8» не дотянули.
 * Таблица перед этим проверена `checkGradeTable`, так что строка найдётся.
 */
export function gradeFromTable(rows: readonly GradeTableRow[], total: number): number | null {
  let found: GradeTableRow | null = null
  for (const row of rows) if (row.min <= total) found = row
  return found ? found.grade : null
}

// ---------------------------------------------------------------------------
// Сумма и оценка
// ---------------------------------------------------------------------------

/** §265. Пятибалльная оценка не ниже 2: ноль и единицу 5-балльной работе не ставят. */
export function fiveFloor(grade: number | null): number | null {
  return grade == null ? null : Math.max(2, grade)
}

/**
 * Сумма и оценка работы по критериям (§260).
 *
 * Порядок решений:
 *  1. Ни у одного задания нет `max_points` → `grading: null`: баллов по
 *     критериям нет, вызывающий считает прежним `computeScore`.
 *  2. Баллы есть не у всех заданий → расхождение: часть критериев не дочиталась.
 *  3. `max_total` из критериев есть и не равен сумме максимумов → расхождение.
 *  4. Таблица есть, но кривая или не покрывает 0..max ровно → расхождение.
 *  5. Есть несверенные задания (балла нет): по таблице оценку не даём —
 *     таблица меряет всю работу, а не её часть; без таблицы — доля по
 *     сверенным, как у `computeScore` (несверенное ни за, ни против).
 *  6. Таблица годна → оценка по ней (шкала `five`); при шкале `hundred` (и
 *     без шкалы) — процент round(total / max · 100), как у `computeScore`.
 *  7. Таблицы нет → доля total / max → `fiveFromRatio` или процент.
 */
export function gradeByCriteria(input: {
  tasks: readonly TaskRow[]
  gradeTable: unknown
  maxTotal: unknown
  scale: GradeScale | string | null
}): CriteriaGrade {
  const pointed = input.tasks.filter(t => t.max_points != null)
  if (pointed.length === 0) {
    return { grading: null, total: null, max: null, score: null, gradeTable: null, problem: null }
  }
  const max = round2(pointed.reduce((sum, t) => sum + (t.max_points ?? 0), 0))
  const scored = pointed.filter(t => t.points != null)
  const total = round2(scored.reduce((sum, t) => sum + (t.points ?? 0), 0))
  const table = parseGradeTable(input.gradeTable)
  const tableRows = table && table.rows.length > 0 ? table.rows : null
  const mismatch = (problem: string): CriteriaGrade =>
    ({ grading: 'criteria_mismatch', total, max, score: null, gradeTable: tableRows, problem })

  const missing = input.tasks.filter(t => t.max_points == null).map(t => t.no)
  if (missing.length > 0) return mismatch(`нет баллов по критериям у заданий ${listNos(missing)}`)

  const maxTotal = parsePoints(input.maxTotal)
  if (maxTotal != null && Math.abs(maxTotal - max) > 1e-9) {
    return mismatch(`сумма максимумов по заданиям ${fmt(max)}, а в критериях максимум ${fmt(maxTotal)}`)
  }

  if (table) {
    if (table.broken) return mismatch('таблица перевода прочитана с ошибкой')
    const problem = checkGradeTable(table.rows, max)
    if (problem) return mismatch(problem)
  }

  const grading: Grading = table ? 'criteria' : 'ratio'
  const unchecked = pointed.length - scored.length
  if (max <= 0) return { grading, total, max, score: null, gradeTable: tableRows, problem: null }

  if (table) {
    if (unchecked > 0) return { grading, total, max, score: null, gradeTable: tableRows, problem: null }
    // §265. У 5-балльной работы оценка только 2–5: «1» из таблицы перевода (бывает в критериях)
    // сервер не примет (topic_homework_reviews_scale_trg), так что и предлагать её нельзя.
    const score = input.scale === 'five' ? fiveFloor(gradeFromTable(table.rows, total)) : Math.round((total / max) * 100)
    return { grading, total, max, score, gradeTable: tableRows, problem: null }
  }

  const countedMax = round2(scored.reduce((sum, t) => sum + (t.max_points ?? 0), 0))
  if (countedMax <= 0) return { grading, total, max, score: null, gradeTable: null, problem: null }
  const ratio = total / countedMax
  const score = input.scale === 'five' ? fiveFromRatio(ratio) : Math.round(ratio * 100)
  return { grading, total, max, score, gradeTable: null, problem: null }
}

/** «12», «2,5» — число баллов по-русски. */
export function fmt(n: number): string {
  return String(round2(n)).replace('.', ',')
}

// ---------------------------------------------------------------------------
// Приписки к разбору и уверенность
// ---------------------------------------------------------------------------

/** Начало пометки — по нему панель узнаёт абзац, и тест держит текст одним. */
export const CRITERIA_MISMATCH_HEAD = 'Проверьте баллы: критерии прочитаны не полностью'

/**
 * Приписка о расхождении. Оценка не подставлена — учитель должен знать
 * почему, иначе пустое поле прочтётся как «ИИ не справился».
 */
export function withCriteriaNote(summary: string, grade: CriteriaGrade): string {
  if (grade.grading !== 'criteria_mismatch') return summary
  const note = `${CRITERIA_MISMATCH_HEAD} (${grade.problem ?? 'сверка не сошлась'}). Оценка не подставлена — сверьте баллы с критериями.`
  return summary ? `${summary}\n\n${note}` : note
}

/** Приписка о неокруглённых ответах, засчитанных полным баллом (§260). */
export function withRoundedNote(summary: string, rounded: readonly string[]): string {
  if (rounded.length === 0) return summary
  const what = rounded.length === 1 ? 'задании' : 'заданиях'
  const note = `Ответ не округлён до знаков эталона в ${what} ${listNos(rounded)} — засчитано как верный. Если критерии требуют округления, снимите балл.`
  return summary ? `${summary}\n\n${note}` : note
}

/** При расхождении уверенность не выше `medium`: оценки нет, а «высокая» обещала бы её. */
export function capConfidence<C extends string | null>(confidence: C, grade: CriteriaGrade): C {
  if (grade.grading === 'criteria_mismatch' && confidence === 'high') return 'medium' as C
  return confidence
}

// ---------------------------------------------------------------------------
// Промпт
// ---------------------------------------------------------------------------

/**
 * Строки промпта для работы с критериями (§260): что добавить в каждую строку
 * таблицы и что — в корень ответа. Отдельно от `buildPrompt`, чтобы одно и
 * то же правило не расползлось копиями.
 */
export const CRITERIA_POINTS_RULES: readonly string[] = [
  '- БАЛЛЫ ПО КРИТЕРИЯМ: в каждой строке tasks укажи "points" — сколько баллов ученик получает за задание ПО КРИТЕРИЯМ — и "max_points" — максимум за это задание по критериям. Частичный балл ставь ТОЛЬКО там, где критерии его дают; где критерий «всё или ничего» — только 0 или максимум.',
  '- Задание, которое сверить не удалось: "verdict": "unchecked", "points": null (max_points всё равно укажи).',
  '- verdict система выведет из баллов сама (максимум — correct, 0 — wrong, иначе partial); заполни его так же.',
  '- "grade_table" — таблица перевода суммы баллов в оценку, ДОСЛОВНО из критериев: [{"min": 11, "max": 12, "grade": 5}, …] по каждой строке. Если в критериях такой таблицы нет — пустой массив [].',
  '- "max_total" — максимальный балл за всю работу, как он написан в критериях (например, «максимум 12 баллов» → 12); если не написан — null.',
  '- СУММУ И ОЦЕНКУ НЕ СЧИТАЙ: их посчитает система по твоим points и таблице. suggested_score можешь не писать.',
]

/** Пример строки tasks и полей корня для образца JSON в промпте. */
export const CRITERIA_JSON_EXAMPLE = {
  task: '{"no": "6", "verdict": "partial", "points": 1, "max_points": 2, "student_answer": "121", "expected_answer": "112", "note": "одна ошибка — 1 балл по критериям"}',
  root: '"grade_table": [{"min": 11, "max": 12, "grade": 5}, {"min": 8, "max": 10, "grade": 4}, {"min": 5, "max": 7, "grade": 3}, {"min": 0, "max": 4, "grade": 2}], "max_total": 12,',
}
