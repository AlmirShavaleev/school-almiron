/**
 * Даты ЕГЭ по предметам — ОДНО место (письмо ЛК_стиль_главная_как_notion.md,
 * 16.10). Официального расписания ЕГЭ-2027 ещё нет: ориентир — 1 июня 2027,
 * поэтому `approx: true` и «≈» в подписи. Вышло расписание — меняется только
 * эта таблица. Плашка «N дней до ЕГЭ» в старой шапке (`EXAM_DATES`,
 * egeScales.ts) — ориентир по экзамену в целом и с этой таблицей совпадает.
 */
import { daysUntil } from '@/lib/examCountdown'
import { plural } from '@/lib/plural'

export type ExamSubject = 'physics' | 'math'

export interface ExamDay {
  /** YYYY-MM-DD по Москве. */
  day: string
  approx: boolean
  /** «по физике». */
  of: string
  /** «Физика». */
  short: string
}

export const EXAM_DAYS: Readonly<Record<ExamSubject, ExamDay>> = {
  physics: { day: '2027-06-01', approx: true, of: 'по физике', short: 'Физика' },
  math: { day: '2027-06-01', approx: true, of: 'по математике', short: 'Математика' },
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «≈ 1 июня» / «1 июня». */
export function examDayLabel(d: ExamDay): string {
  const [, m, dd] = d.day.split('-').map(Number)
  return `${d.approx ? '≈ ' : ''}${dd} ${MONTHS_GEN[m - 1]}`
}

/** Учебный год экзамена начинается 1 сентября предыдущего года. */
export function schoolYearStart(examDay: string): string {
  return `${Number(examDay.slice(0, 4)) - 1}-09-01`
}

/** Доля учебного года (1 сент → день экзамена), пройденная к `today`, 0..100. */
export function schoolYearPercent(today: string, examDay: string): number {
  const total = daysUntil(schoolYearStart(examDay), examDay)
  const passed = daysUntil(schoolYearStart(examDay), today)
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((passed / total) * 100)))
}

export interface ExamWidgetData {
  /** Ближайший экзамен — крупным числом. */
  main: { subject: ExamSubject; days: number; daysWord: string; of: string; dateLabel: string }
  yearPercent: number
  /** Чипы по каждому предмету ученика: «Физика · 228 дн». */
  chips: Array<{ subject: ExamSubject; label: string }>
}

/**
 * Виджет «До ЕГЭ»: предметы ученика (курсы ЕГЭ по физике/математике). Экзамен
 * прошёл или предметов нет — null (виджет не показывается).
 */
export function examWidget(today: string, subjects: readonly string[]): ExamWidgetData | null {
  const list = [...new Set(subjects)]
    .filter((s): s is ExamSubject => s === 'physics' || s === 'math')
    .map(subject => ({ subject, d: EXAM_DAYS[subject], days: daysUntil(today, EXAM_DAYS[subject].day) }))
    .filter(x => x.days > 0)
    .sort((a, b) => a.days - b.days)
  if (list.length === 0) return null
  const first = list[0]
  return {
    main: {
      subject: first.subject,
      days: first.days,
      daysWord: plural(first.days, 'день', 'дня', 'дней'),
      of: first.d.of,
      dateLabel: examDayLabel(first.d),
    },
    yearPercent: schoolYearPercent(today, first.d.day),
    chips: list.map(x => ({ subject: x.subject, label: `${x.d.short} · ${x.days} дн` })),
  }
}
