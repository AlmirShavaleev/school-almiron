/**
 * §255. Плашка «242 дня до ЕГЭ · примерно, до 1 июня» в шапке главной.
 *
 * «Сегодня» — день по Москве от СЕРВЕРА (`today` из `student_home_activity`,
 * как у серии §254), а не часы устройства: у ученика с неверными часами или в
 * другом поясе число не прыгает на сутки. Дата экзамена — `EXAM_DATES`
 * (`egeScales.ts`), одна константа на год.
 *
 * Кому: есть курс ЕГЭ — «до ЕГЭ»; только ОГЭ — «до ОГЭ»; ни того ни другого —
 * плашки нет. В день экзамена и после — плашки нет (не «0 дней», не «−3 дня»).
 */
import { EXAM_DATES } from '@/lib/egeScales'
import { plural } from '@/lib/plural'

export interface ExamCountdown {
  exam:  'ege' | 'oge'
  days:  number
  /** «242 дня» — число со словом. */
  daysWord: string
  /** «до ЕГЭ». */
  label: string
  note:  string
  hint:  string
}

const DAY_MS = 86_400_000
const dayMs = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}

/** Целых календарных дней от `today` до `examDay` (оба YYYY-MM-DD). */
export function daysUntil(today: string, examDay: string): number {
  return Math.round((dayMs(examDay) - dayMs(today)) / DAY_MS)
}

/** Московский день момента времени — для тех мест, где есть только момент. */
export function mskDayOf(at: Date): string {
  return new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * Какой экзамен показывать: ЕГЭ важнее ОГЭ (у ученика может быть и то и
 * другое — 11 класс с повторением курса 9-го). Остальные курсы не в счёт.
 */
export function examForCourses(examTypes: readonly (string | null | undefined)[]): 'ege' | 'oge' | null {
  if (examTypes.includes('ege')) return 'ege'
  if (examTypes.includes('oge')) return 'oge'
  return null
}

export function examCountdown(today: string | null | undefined, examTypes: readonly (string | null | undefined)[]): ExamCountdown | null {
  if (!today || !/^\d{4}-\d{2}-\d{2}/.test(today)) return null
  const exam = examForCourses(examTypes)
  if (!exam) return null
  const date = EXAM_DATES[exam]
  const days = daysUntil(today, date.day)
  if (days <= 0) return null
  return {
    exam,
    days,
    daysWord: plural(days, 'день', 'дня', 'дней'),
    label: exam === 'ege' ? 'до ЕГЭ' : 'до ОГЭ',
    note: date.note,
    hint: date.hint,
  }
}
