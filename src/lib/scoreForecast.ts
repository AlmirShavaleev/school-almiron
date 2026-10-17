/**
 * Хранимый прогноз балла ЕГЭ (письмо ЛК_прогноз_балла_хранить.md, 16.10):
 * считает ночью Edge Function `forecast-daily` тем же модулем, что браузер
 * (`supabase/functions/_shared/scoreForecast.ts`), сайт только читает —
 * `my_score_forecast()`, `course_score_forecast(course)`, `student_score_forecast(student)`.
 *
 * Пока миграция PENDING_score_forecast не применена, функций нет: чтение
 * возвращает `null` («нет хранимого»), и экраны считают прогноз по-старому,
 * в браузере. Пустой массив — функция есть, строк ещё нет («появится завтра»).
 */
import { supabase } from '@/lib/supabase'
import { isEgeSubject, type EgeSubject } from '@/lib/egeScales'
import type { StoredForecastDetails } from '../../supabase/functions/_shared/scoreForecast.ts'

export interface StoredForecast {
  subject: EgeSubject
  score: number | null
  low: number | null
  high: number | null
  basis: string
  ready: boolean
  covered: number
  need: number
  missing: number
  monthDelta: number | null
  weekAgo: number | null
  /** [n, p, задач, доля верного | null, из каталога] — для слабых номеров. */
  numbers: StoredForecastDetails['numbers']
  computedAt: Date | null
  /** Ученик (сводка класса). */
  studentId?: string
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

export function normalizeStoredForecasts(raw: unknown): StoredForecast[] {
  if (!Array.isArray(raw)) return []
  const out: StoredForecast[] = []
  for (const item of raw) {
    const x = (item ?? {}) as Record<string, unknown>
    if (!isEgeSubject(x.subject)) continue
    const d = (x.details && typeof x.details === 'object' ? x.details : {}) as Partial<StoredForecastDetails>
    const at = typeof x.computed_at === 'string' ? new Date(x.computed_at) : null
    out.push({
      subject: x.subject,
      score: int(x.score),
      low: int(x.low),
      high: int(x.high),
      basis: typeof x.basis === 'string' ? x.basis : '',
      ready: d.ready === true && int(x.score) != null,
      covered: int(d.covered) ?? 0,
      need: int(d.need) ?? 0,
      missing: int(d.missing) ?? 0,
      monthDelta: int(d.month_delta),
      weekAgo: int(d.week_ago),
      numbers: Array.isArray(d.numbers) ? d.numbers : [],
      computedAt: at && Number.isFinite(at.getTime()) ? at : null,
      studentId: typeof x.student_id === 'string' ? x.student_id : undefined,
    })
  }
  return out
}

type Res = { data: unknown; error: { code?: string; message?: string } | null }

async function read(fn: string, args?: Record<string, unknown>): Promise<StoredForecast[] | null> {
  try {
    const { data, error } = (await supabase.rpc(fn as never, args as never)) as unknown as Res
    // Нет функции (миграция не применена), нет прав, сбой — «хранимого нет»: экран считает по-старому.
    if (error) return null
    return normalizeStoredForecasts(data)
  } catch {
    return null
  }
}

/** Свой прогноз (ученик). null — хранимого нет (функции нет или сбой). */
export const fetchMyScoreForecast = () => read('my_score_forecast')
/** Прогноз учеников курса (персонал). */
export const fetchCourseScoreForecast = (courseId: string) => read('course_score_forecast', { p_course_id: courseId })
/** Прогноз ученика для карточки у персонала. */
export const fetchStudentScoreForecast = (studentId: string) => read('student_score_forecast', { p_student_id: studentId })

/** «обновлено сегодня в 04:10» / «обновлено 15 окт в 04:10» — по Москве. */
export function computedLabel(at: Date | null, now: Date = new Date()): string | null {
  if (!at) return null
  const day = (d: Date) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).format(d).replace('.', '')
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(at)
  return `обновлено ${day(at) === day(now) ? 'сегодня' : day(at)} в ${time}`
}

/**
 * Короткая подпись прогноза рядом с целью: «прогноз 64», «прогноз: мало данных»,
 * «прогноз появится завтра» (функция есть, строки ещё нет — новый ученик).
 * null — хранимого прогноза нет вовсе (миграция не применена): подписи нет.
 */
export function forecastNote(rows: StoredForecast[] | null, subject: string): string | null {
  if (rows == null) return null
  const r = rows.find(x => x.subject === subject)
  if (!r) return 'прогноз появится завтра'
  return r.ready && r.score != null ? `прогноз ${r.score}` : 'прогноз: мало данных'
}

/** Подсказка: «по 46 задачам и 1 пробнику · обновлено сегодня в 04:10». */
export function forecastHint(rows: StoredForecast[] | null, subject: string, now: Date = new Date()): string | undefined {
  const r = rows?.find(x => x.subject === subject)
  if (!r) return undefined
  return [r.ready && r.low != null && r.high != null ? `скорее всего от ${r.low} до ${r.high}` : null, r.basis, computedLabel(r.computedAt, now)]
    .filter(Boolean).join(' · ') || undefined
}
