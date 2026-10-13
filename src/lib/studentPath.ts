/**
 * §290-B «Путь ученика после регистрации» — анкета, витрина «Курсы», плашка
 * пробного на главной, замок демо на странице курса.
 *
 * Решает база (PENDING_290_a_path.sql): кому нужна анкета, что в витрине и
 * какие цены, демо ли курс, какой урок «продолжить». Здесь — вызовы и слова.
 * Сеть — функции fetch… и save…; остальное чистое (тесты: studentPath.test.ts).
 */
import { supabase } from '@/lib/supabase'
import { plural } from '@/lib/plural'
import { formatDateMsk } from '@/lib/subscription/view'

export type Subject = 'physics' | 'math'
export type DiagnosticStatus = 'none' | 'in_progress' | 'done' | 'skipped'

/** Ответ `onboarding_state()`. */
export interface OnboardingState {
  needed: boolean
  completed: boolean
  grade: number | null
  exam: 'ege' | null
  subject: Subject | null
  target_score: number | null
  months_to_exam: number | null
  hours_per_week: number | null
  diagnostic_status: DiagnosticStatus
}

export interface OnboardingForm {
  grade: 9 | 10 | 11 | null
  subject: Subject | null
  target_score: string
  months_to_exam: string
  hours_per_week: string
}

/** Подписка ученика из `student_path_home()`. */
export interface PathSubscription {
  subscription_id: string
  course_id: string
  course_title: string
  group_id: string | null
  tariff_id: string
  status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'
  source: 'purchase' | 'trial' | 'manual'
  /** Обычный пробный период: открыты первые 2 урока раздела. */
  demo: boolean
  has_access: boolean
  access_until: string | null
  auto_renew: boolean
  continue: { topic_id: string; title: string; module_title: string | null } | null
}

export interface StudentPathHome {
  onboarding: OnboardingState
  subscriptions: PathSubscription[]
}

export interface ShowcaseTariff {
  id: string
  title: string
  price_rub: number
  period_months: number
  trial_days: number
}

/** Карточка из `courses_showcase()`. */
export interface ShowcaseCard {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string | null
  includes: string[]
  subject: Subject | null
  course_id: string | null
  status: 'live' | 'soon'
  tariffs: ShowcaseTariff[]
  month_price: number | null
  year_price: number | null
  year_discount_pct: number | null
  trial_days: number
  my_status: string | null
  my_access_until: string | null
  has_access: boolean
  trial_available: boolean
  notify_requested: boolean
}

export class PathError extends Error {
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
    throw new PathError(e.message ?? 'Ошибка', e.hint ?? e.code ?? null)
  }
  return data as T
}

/** Главная: анкета и подписки. Сбой (нет функции, нет сети) — null: главная как раньше. */
export async function fetchStudentPathHome(): Promise<StudentPathHome | null> {
  try {
    const d = await rpc<StudentPathHome | null>('student_path_home')
    return d && d.onboarding && Array.isArray(d.subscriptions) ? d : null
  } catch {
    return null
  }
}

/** Демо ли курс у ученика; сбой — не демо (замки как раньше). */
export async function fetchCourseDemo(courseId: string): Promise<boolean> {
  try {
    const d = await rpc<{ demo?: boolean } | null>('my_course_demo', { p_course_id: courseId })
    return d?.demo === true
  } catch {
    return false
  }
}

export function saveOnboarding(f: OnboardingForm): Promise<OnboardingState> {
  return rpc<OnboardingState>('onboarding_save', {
    p: {
      grade: f.grade,
      exam: 'ege',
      subject: f.subject,
      target_score: Number(f.target_score),
      months_to_exam: f.months_to_exam.trim() ? Number(f.months_to_exam) : null,
      hours_per_week: f.hours_per_week.trim() ? Number(f.hours_per_week) : null,
    },
  })
}

export function fetchShowcase(): Promise<ShowcaseCard[]> {
  return rpc<ShowcaseCard[]>('courses_showcase').then((d) => d ?? [])
}

export function requestLaunchNotice(showcaseId: string): Promise<boolean> {
  return rpc<boolean>('course_showcase_notify', { p_showcase_id: showcaseId })
}

// ── анкета ────────────────────────────────────────────────────────────────

/** Ошибки анкеты по полям; пусто — можно сохранять. Те же правила — в onboarding_save. */
export function onboardingErrors(f: OnboardingForm): Partial<Record<keyof OnboardingForm, string>> {
  const e: Partial<Record<keyof OnboardingForm, string>> = {}
  if (!f.grade) e.grade = 'Выберите класс'
  if (!f.subject) e.subject = 'Выберите предмет'
  const t = Number(f.target_score)
  if (!f.target_score.trim() || !Number.isInteger(t) || t < 0 || t > 100) e.target_score = 'Балл — от 0 до 100'
  const m = Number(f.months_to_exam)
  if (f.months_to_exam.trim() && (!Number.isInteger(m) || m < 1 || m > 36)) e.months_to_exam = 'От 1 до 36 месяцев'
  const h = Number(f.hours_per_week)
  if (f.hours_per_week.trim() && (!Number.isInteger(h) || h < 1 || h > 40)) e.hours_per_week = 'От 1 до 40 часов'
  return e
}

/**
 * Месяцев до ЕГЭ по умолчанию: до 1 июня года экзамена (11 класс — ближайший
 * июнь, 10 — следующий, 9 — через год). Ученику — подсказка, поле правится.
 */
export function defaultMonthsToExam(grade: 9 | 10 | 11, now: Date = new Date()): number {
  const y = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()
  const examYear = y + (11 - grade)
  const months = (examYear - now.getFullYear()) * 12 + (5 - now.getMonth())
  return Math.max(1, Math.min(36, months))
}

// ── главная ───────────────────────────────────────────────────────────────

export interface PathBanner {
  kind: 'demo' | 'promo'
  courseId: string
  courseTitle: string
  text: string
}

/** Целых суток до конца (вверх): 2 ч 10 мин → 1, 49 ч → 3. */
export function daysLeft(until: string | null, now: Date = new Date()): number | null {
  if (!until) return null
  const ms = new Date(until).getTime() - now.getTime()
  if (Number.isNaN(ms) || ms <= 0) return null
  return Math.ceil(ms / 86_400_000)
}

/**
 * Плашка на главной. Обычный пробный — «До конца пробного — N дня», промо-дни
 * (курс открыт целиком) — «Курс открыт до …». Оплаченная подписка — без плашки.
 */
export function pathBanners(subs: PathSubscription[], now: Date = new Date()): PathBanner[] {
  const out: PathBanner[] = []
  for (const s of subs) {
    if (!s.has_access || s.status !== 'trial') continue
    if (s.demo) {
      const n = daysLeft(s.access_until, now)
      if (n == null) continue
      out.push({
        kind: 'demo', courseId: s.course_id, courseTitle: s.course_title,
        text: `До конца пробного — ${n} ${plural(n, 'день', 'дня', 'дней')}`,
      })
    } else {
      const until = formatDateMsk(s.access_until)
      if (!until) continue
      out.push({ kind: 'promo', courseId: s.course_id, courseTitle: s.course_title, text: `Курс открыт до ${until}` })
    }
  }
  return out
}

// ── «Курсы» ───────────────────────────────────────────────────────────────

/** Тариф карточки на выбранный период (1 или 12 месяцев); нет — null. */
export function tariffFor(card: ShowcaseCard, months: 1 | 12): ShowcaseTariff | null {
  return card.tariffs.find((t) => t.period_months === months) ?? null
}

/** Подпись главной кнопки карточки и куда она ведёт. */
export function cardAction(card: ShowcaseCard): 'notify' | 'open' | 'trial' | 'buy' {
  if (card.status !== 'live') return 'notify'
  if (card.has_access) return 'open'
  if (card.trial_available) return 'trial'
  return 'buy'
}

// ── страница курса ────────────────────────────────────────────────────────

/** Подпись замка урока в демо: не «после урока …» — дальше по прохождению в демо не открывается. */
export const DEMO_LOCK_NOTE = 'Доступно по подписке'

/**
 * Демо: у закрытых уроков (решение базы уже в `progress`) подпись «Доступно
 * по подписке». Не демо — разделы как есть.
 */
export function withDemoLocks<M extends { topics: ReadonlyArray<{ progress?: { open: boolean; note: string | null } | null }> }>(
  modules: M[],
  demo: boolean,
): M[] {
  if (!demo) return modules
  return modules.map((m) => ({
    ...m,
    topics: m.topics.map((t) => (t.progress && !t.progress.open ? { ...t, progress: { ...t.progress, note: DEMO_LOCK_NOTE } } : t)),
  }))
}
