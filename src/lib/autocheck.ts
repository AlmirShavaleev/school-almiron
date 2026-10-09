/**
 * §266. Тренировочные уроки: задачи с автопроверкой.
 *
 * Вердикт ставит ТОЛЬКО сервер (`topic_autocheck_check`, сравнение —
 * `autocheck_answer_correct` в PENDING_266.sql): эталона у клиента до закрытия
 * задачи нет вовсе. Здесь — то, что нужно экрану до запроса и после ответа:
 *  - разбор ввода (запятая или точка, пробелы, минус «−»/«-») — чтобы сказать
 *    «Введите число» сразу и не гонять запрос, который сервер всё равно
 *    отклонит, не потратив попытку; правило то же, что у сервера;
 *  - итог урока (round(100 × решённые / все)) — тот же, что пишет сервер в
 *    журнал, и подписи «Решено N из M · оценка …»;
 *  - разбор ответа RPC в типы экрана.
 */

import { plural } from '@/lib/plural'

/** Пометка урока (topics.lesson_format). null — без пометки, как до §266. */
export type LessonFormat = 'training' | 'ege'

export const LESSON_FORMAT_LABEL: Record<LessonFormat, string> = {
  training: 'Тренировочный',
  ege: 'Формат ЕГЭ',
}

export const LESSON_FORMAT_HINT: Record<LessonFormat, string> = {
  training: 'Подтема: видео, задачи урока, рабочий лист, решения и задачи с автопроверкой вместо ДЗ на проверку',
  ege: 'Задания по номеру ЕГЭ и обычное ДЗ, которое проверяет учитель',
}

export function normalizeLessonFormat(value: unknown): LessonFormat | null {
  return value === 'training' || value === 'ege' ? value : null
}

/** Попыток на задачу — то же число, что CHECK в базе. */
export const AUTOCHECK_MAX_ATTEMPTS = 3

export type AutocheckAnswerType = 'number' | 'digits'

/** Минусы, которые люди набирают вместо «-»: U+2212 и тире. */
const MINUS_LIKE = /[−–—]/g
/** Пробелы, включая неразрывный и узкие (так копируются числа из PDF). */
const SPACES = /[\s   ]/g

/** Число из ввода ученика или null. «1 200,5» → 1200.5, «−12,5» → −12.5. */
export function parseNumberAnswer(raw: string): number | null {
  const s = raw.replace(MINUS_LIKE, '-').replace(SPACES, '').replace(/,/g, '.')
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Строка цифр из ввода или null. Разделители (пробел, запятая, точка с запятой, точка) игнорируются. */
export function parseDigitsAnswer(raw: string): string | null {
  const s = raw.replace(/[\s   ,;.]/g, '')
  return /^\d+$/.test(s) ? s : null
}

/** Сообщение «не тот вид ответа» или null, если ответ можно отправлять. */
export function answerFormatError(type: AutocheckAnswerType, raw: string): string | null {
  if (!raw.trim()) return 'Введите ответ'
  if (type === 'number') return parseNumberAnswer(raw) === null ? 'Введите число' : null
  return parseDigitsAnswer(raw) === null ? 'Введите цифры ответа' : null
}

/** Итог урока по 100-балльной шкале: round(100 × решённые / все). null — задач нет. */
export function autocheckGrade(solved: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((100 * solved) / total)
}

/** «3 попытки», «1 попытка». */
export function attemptsWord(n: number): string {
  return plural(n, 'попытка', 'попытки', 'попыток')
}

export interface AutocheckAnswer {
  attemptNo: number
  answer: string
  correct: boolean
}

export interface AutocheckTask {
  id: string
  code: string
  position: number
  statementPath: string
  /** §278. Условие текстом (Markdown + LaTeX); null — показываем картинку statementPath. */
  statementMd: string | null
  answerType: AutocheckAnswerType
  digitsAnyOrder: boolean
  unit: string | null
  attemptsUsed: number
  attemptsLeft: number
  solved: boolean
  closed: boolean
  answers: AutocheckAnswer[]
  /** Эталон — только у закрытой задачи (или у персонала). */
  answerValue: number | null
  answerTol: number | null
  answerText: string | null
  solutionPath: string | null
  /** §278. Решение текстом; приходит только когда задача закрыта (или персоналу). */
  solutionMd: string | null
}

export interface AutocheckState {
  topicId: string
  isStaff: boolean
  tasks: AutocheckTask[]
  total: number
  solved: number
  closed: number
  finished: boolean
  grade: number | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Ответ RPC `topic_autocheck_state` → типы экрана. Неизвестное — безопасные умолчания. */
export function parseAutocheckState(raw: unknown): AutocheckState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const tasks = Array.isArray(r.tasks) ? r.tasks : []
  const parsed: AutocheckTask[] = tasks.map((t: Record<string, unknown>) => ({
    id: String(t.id),
    code: String(t.code ?? ''),
    position: num(t.position) ?? 0,
    statementPath: String(t.statement_path ?? ''),
    statementMd: typeof t.statement_md === 'string' && t.statement_md.trim() ? t.statement_md : null,
    answerType: t.answer_type === 'digits' ? 'digits' : 'number',
    digitsAnyOrder: t.digits_any_order === true,
    unit: typeof t.unit === 'string' && t.unit ? t.unit : null,
    attemptsUsed: num(t.attempts_used) ?? 0,
    attemptsLeft: num(t.attempts_left) ?? AUTOCHECK_MAX_ATTEMPTS,
    solved: t.solved === true,
    closed: t.closed === true,
    answers: Array.isArray(t.answers)
      ? (t.answers as Record<string, unknown>[]).map(a => ({
          attemptNo: num(a.attempt_no) ?? 0,
          answer: String(a.answer ?? ''),
          correct: a.correct === true,
        }))
      : [],
    answerValue: num(t.answer_value),
    answerTol: num(t.answer_tol),
    answerText: typeof t.answer_text === 'string' ? t.answer_text : null,
    solutionPath: typeof t.solution_path === 'string' && t.solution_path ? t.solution_path : null,
    solutionMd: typeof t.solution_md === 'string' && t.solution_md.trim() ? t.solution_md : null,
  }))
  parsed.sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
  return {
    topicId: String(r.topic_id ?? ''),
    isStaff: r.is_staff === true,
    tasks: parsed,
    total: num(r.total) ?? parsed.length,
    solved: num(r.solved) ?? 0,
    closed: num(r.closed) ?? 0,
    finished: r.finished === true,
    grade: num(r.grade),
  }
}

/**
 * Состояние ученика «с нуля» — для предпросмотра персонала (§178): персонал
 * получает от сервера эталоны, но в роли ученика их видеть не должен.
 */
export function asFreshStudent(state: AutocheckState): AutocheckState {
  return {
    ...state,
    isStaff: false,
    finished: false,
    grade: null,
    solved: 0,
    closed: 0,
    tasks: state.tasks.map(t => ({
      ...t,
      attemptsUsed: 0,
      attemptsLeft: AUTOCHECK_MAX_ATTEMPTS,
      solved: false,
      closed: false,
      answers: [],
      answerValue: null,
      answerTol: null,
      answerText: null,
      solutionPath: null,
      solutionMd: null,
    })),
  }
}

/** Эталон словами: «100 м», «31 (порядок не важен)», «2,5 ± 0,05 м/с». */
export function formatCorrectAnswer(t: Pick<AutocheckTask, 'answerType' | 'answerValue' | 'answerTol' | 'answerText' | 'digitsAnyOrder' | 'unit'>): string | null {
  if (t.answerType === 'digits') {
    if (!t.answerText) return null
    return t.digitsAnyOrder ? `${t.answerText} (порядок не важен)` : t.answerText
  }
  if (t.answerValue === null) return null
  const fmt = (n: number) => String(n).replace('-', '−').replace('.', ',')
  const tol = t.answerTol && t.answerTol > 0 ? ` ± ${fmt(t.answerTol)}` : ''
  return `${fmt(t.answerValue)}${tol}${t.unit ? ` ${t.unit}` : ''}`
}

/** «Решено N из M · оценка 75 из 100» / «… · оценка после всех задач». */
export function autocheckSummary(state: Pick<AutocheckState, 'solved' | 'total' | 'finished' | 'grade'>): string {
  const grade = state.finished && state.grade !== null ? `${state.grade} из 100` : 'после всех задач'
  return `Решено ${state.solved} из ${state.total} · оценка ${grade}`
}

/** Ошибка RPC проверки → текст для ученика. */
export function autocheckErrorMessage(message: string | null | undefined): string {
  const m = message ?? ''
  if (m.includes('AUTOCHECK_CLOSED')) return 'Задача уже закрыта — попыток больше нет'
  if (m.includes('AUTOCHECK_FORMAT')) {
    const rest = m.split('AUTOCHECK_FORMAT:')[1]?.trim()
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : 'Введите ответ'
  }
  if (/42501|Нет доступа|нет прав/i.test(m)) return 'Нет доступа к этой задаче'
  return 'Не удалось проверить ответ. Попробуйте ещё раз'
}

// ── Результаты класса (учитель) ──────────────────────────────────────────────

export interface AutocheckResultCell {
  taskId: string
  attempts: number
  solved: boolean
  closed: boolean
}

export interface AutocheckResultStudent {
  studentId: string
  name: string
  attempts: number
  solved: number
  closed: number
  finished: boolean
  grade: number | null
  cells: Map<string, AutocheckResultCell>
}

export interface AutocheckResults {
  tasks: Array<{ id: string; code: string; position: number }>
  students: AutocheckResultStudent[]
}

export function parseAutocheckResults(raw: unknown): AutocheckResults {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tasks = (Array.isArray(r.tasks) ? r.tasks : []).map((t: Record<string, unknown>) => ({
    id: String(t.id),
    code: String(t.code ?? ''),
    position: num(t.position) ?? 0,
  }))
  tasks.sort((a, b) => a.position - b.position || a.code.localeCompare(b.code))
  const students = (Array.isArray(r.students) ? r.students : []).map((s: Record<string, unknown>) => {
    const cells = new Map<string, AutocheckResultCell>()
    for (const c of (Array.isArray(s.cells) ? s.cells : []) as Record<string, unknown>[]) {
      const taskId = String(c.task_id)
      cells.set(taskId, {
        taskId,
        attempts: num(c.attempts) ?? 0,
        solved: c.solved === true,
        closed: c.closed === true,
      })
    }
    return {
      studentId: String(s.student_id),
      name: String(s.name ?? 'Без имени'),
      attempts: num(s.attempts) ?? 0,
      solved: num(s.solved) ?? 0,
      closed: num(s.closed) ?? 0,
      finished: s.finished === true,
      grade: num(s.grade),
      cells,
    }
  })
  return { tasks, students }
}

export type ResultsSort = 'name' | 'grade'

/** «Сначала слабые»: итог по возрастанию (не закончившие — в конце), затем по имени. */
export function sortResults(students: AutocheckResultStudent[], by: ResultsSort): AutocheckResultStudent[] {
  const copy = [...students]
  if (by === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return copy.sort((a, b) => {
    const ga = a.finished ? a.grade ?? 0 : Number.POSITIVE_INFINITY
    const gb = b.finished ? b.grade ?? 0 : Number.POSITIVE_INFINITY
    return ga - gb || a.name.localeCompare(b.name, 'ru')
  })
}
