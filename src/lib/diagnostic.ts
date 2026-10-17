/**
 * §289. Стартовая диагностика — вызовы базы и слова для экранов.
 *
 * Решает база (PENDING_289_a_diagnostic.sql): какая задача следующая
 * (адаптивно, ≤ 20), верен ли ответ (те же функции, что в каталоге), карта
 * номеров и слабые места. Здесь — сеть и чистые функции (тесты: diagnostic.test.ts).
 * Прогноз на экране результата — тот же расчёт, что «Примерный балл»
 * (`student_exam_forecast_evidence` → egeForecast), второго нет.
 */
import { supabase } from '@/lib/supabase'
import { plural } from '@/lib/plural'
import type { CatalogTaskAsset } from '@/hooks/useCatalog'
import type { OnboardingState } from '@/lib/studentPath'

export type DiagnosticSubject = 'physics' | 'math'
export type NumberStatus = 'green' | 'yellow' | 'red' | 'grey'

export interface DiagnosticTask {
  id: string
  n: number
  title: string | null
  statement_html: string
  content_format: string | null
  assets: CatalogTaskAsset[]
  shown_at: string | null
}

/** Ответ `diagnostic_start` / `diagnostic_answer`. */
export interface DiagnosticState {
  session_id: string
  subject: DiagnosticSubject
  status: 'in_progress' | 'done'
  answered: number
  max: number
  task: DiagnosticTask | null
}

export interface DiagnosticAnswerRow {
  n: number
  level: 'лёгкая' | 'средняя' | 'сложная'
  title: string | null
  answer: string | null
  verdict: 'correct' | 'wrong' | 'dont_know'
  statement_html: string | null
  correct_html: string | null
  assets: CatalogTaskAsset[]
}

/** Ответ `diagnostic_result` / `diagnostic_result_for`. */
export interface DiagnosticResult {
  subject: DiagnosticSubject
  status: 'in_progress' | 'done'
  started_at: string
  finished_at: string | null
  correct: number
  answered: number
  numbers: Array<{ n: number; title: string | null; status: NumberStatus }>
  weak: Array<{ n: number; title: string | null }>
  answers: DiagnosticAnswerRow[]
  onboarding: { grade: number | null; target_score: number | null; months_to_exam: number | null; hours_per_week: number | null } | null
}

export interface CourseDiagnostic {
  student_id: string
  status: 'in_progress' | 'done'
  finished_at: string | null
  correct: number
  answered: number
}

export class DiagnosticError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.code = code
  }
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, (args ?? {}) as never)
  if (error) {
    const e = error as { message?: string; hint?: string | null; code?: string | null }
    throw new DiagnosticError(e.message ?? 'Ошибка', e.hint ?? e.code ?? null)
  }
  return data as T
}

export function startDiagnostic(subject: DiagnosticSubject = 'physics'): Promise<DiagnosticState> {
  return rpc('diagnostic_start', { p_subject: subject })
}

export function answerDiagnostic(state: DiagnosticState, answer: string | null): Promise<DiagnosticState> {
  return rpc('diagnostic_answer', {
    p_session: state.session_id,
    p_task: state.task?.id,
    p_answer: answer,
    p_dont_know: answer == null,
  })
}

export function fetchDiagnosticResult(subject: DiagnosticSubject = 'physics'): Promise<DiagnosticResult | null> {
  return rpc('diagnostic_result', { p_subject: subject })
}

export function fetchDiagnosticResultFor(studentId: string, subject: DiagnosticSubject = 'physics'): Promise<DiagnosticResult | null> {
  return rpc('diagnostic_result_for', { p_student_id: studentId, p_subject: subject })
}

export function resetDiagnostic(studentId: string): Promise<boolean> {
  return rpc('diagnostic_reset', { p_student_id: studentId })
}

export function skipDiagnostic(): Promise<unknown> {
  return rpc('onboarding_skip_diagnostic')
}

/** Значки «Прохождения»; сбой (нет функции) — пусто. */
export async function fetchCourseDiagnostics(courseId: string): Promise<CourseDiagnostic[]> {
  try {
    const d = await rpc<CourseDiagnostic[] | null>('course_diagnostics', { p_course_id: courseId })
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

/** Код ошибки → текст ученику. */
export function diagnosticErrorText(code: string | null | undefined): string {
  switch (code) {
    case 'NO_SET': return 'Диагностика по этому предмету пока недоступна.'
    case 'NOT_STUDENT': return 'Диагностику проходит учётная запись ученика.'
    case 'EMPTY': return 'Введите ответ или нажмите «Не знаю».'
    case 'STALE': return 'Задача уже сменилась — показываем актуальную.'
    default: return 'Не получилось. Проверьте связь и попробуйте ещё раз.'
  }
}

// ── экраны ──────────────────────────────────────────────────────────────────

/** Карточка «Пройти диагностику» на главной: анкета пройдена (не школьник), диагностика не начата / отложена. */
export function showDiagnosticCard(o: OnboardingState | null | undefined): boolean {
  return !!o && o.completed && (o.diagnostic_status === 'none' || o.diagnostic_status === 'skipped')
}

export const STATUS_LABEL: Record<NumberStatus, string> = {
  green: 'уверенно',
  yellow: 'есть пробелы',
  red: 'нужно разобрать',
  grey: 'не проверяли',
}

/** «№2 «Динамика»» — слабое место словами. */
export function weakText(w: { n: number; title: string | null }): string {
  return w.title ? `${w.title} (№${w.n})` : `Задание №${w.n}`
}

export interface StudyPlan {
  /** Тем в неделю (урок ≈ 2 часа с ДЗ). */
  topicsPerWeek: number
  text: string
}

/**
 * Личный план из анкеты: тем в неделю по часам (урок с ДЗ ≈ 2 часа, от 1 до
 * 5) и с чего начать — первое слабое место. Часов нет — 2 темы в неделю.
 */
export function studyPlan(hoursPerWeek: number | null | undefined, weak: Array<{ n: number; title: string | null }>): StudyPlan {
  const h = hoursPerWeek && hoursPerWeek > 0 ? hoursPerWeek : 4
  const k = Math.min(5, Math.max(1, Math.round(h / 2)))
  const start = weak[0] ? `Начните с темы «${weak[0].title ?? `№${weak[0].n}`}».` : 'Начните с первого раздела курса.'
  return { topicsPerWeek: k, text: `${start} Темп — ${k} ${plural(k, 'тема', 'темы', 'тем')} в неделю.` }
}
