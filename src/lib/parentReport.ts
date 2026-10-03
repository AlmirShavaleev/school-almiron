/**
 * §217. Отчёт об успеваемости — разбор ответа `student_progress_report`.
 *
 * Сами числа считает база (`supabase/migrations/PENDING_217.sql`): экран в
 * кабинете и лист для родителя обязаны показывать ОДНО И ТО ЖЕ, а десять
 * запросов из клиента расходятся при первой же правке. Здесь только то, что
 * относится к печати числа на бумаге: подписи, прочерки и точки графика.
 *
 * §261 (решение владельца 03.10): на листе появился «Примерный балл на ЕГЭ» — но ТОЛЬКО когда данных достаточно,
 * по тому же правилу покрытия, что у ученика на главной (§255, `egeForecast.ts`); иначе честная строка «Пока мало
 * данных для прогноза». Считает его не этот модуль, а `lib/studentOverview.ts` той же моделью.
 */

import { plural } from './plural'
import {
  assessmentSummary, deadlineNote, formatGrade, gradeAverage, homeworkDeadlineSummary, normalizeAssessments,
  normalizeHomeworks, worksWord, type AssessmentRow, type HomeworkRow,
} from './studentOverview'

/**
 * Порог «печатать ли среднее по группе». Второй рубеж: база уже отдаёт null,
 * когда людей меньше (`c_min_group` в PENDING_217.sql). Число одно и то же, и
 * менять его нужно в обоих местах — оно про приватность чужих детей, а не про
 * вёрстку: в группе из трёх среднее рядом с баллом сына позволяет родителю
 * вычислить остальных.
 */
export const MIN_GROUP_FOR_AVG = 6

/** Тема идёт в списки сильных/слабых от трёх засчитанных заданий. */
export const MIN_TASKS_FOR_TOPIC = 3

export interface ReportWeek {
  week_start: string
  avg_percent: number
  works: number
}

export interface ReportMock {
  date: string
  title: string
  subject?: string
  exam_type?: string
  score: number
  part1: number | null
  part2: number | null
  group_avg: number | null
  group_size: number
  delta: number | null
}

export interface ReportSubject {
  subject: string
  exam_type: string
  course_titles: string | null
  target: number | null
  avg_percent: number | null
  graded_works: number
  group_size: number
  group_avg_percent: number | null
  works: {
    submitted: number
    accepted: number
    revision: number
    pending: number
    with_due: number
    on_time: number
    late: number
  }
  weeks: ReportWeek[]
  last_mock: ReportMock | null
  /** §261: цель, которую ученик поставил себе сам (student_exam_goals), только ЕГЭ; null — нет. Поля нет — база до §261. */
  exam_goal?: number | null
  /** §261: проверочные и контрольные периода (сырой ответ; разбор — `normalizeAssessments`). */
  assessments?: unknown[]
  /** §261: ДЗ уроков периода — срок и первая сдача (разбор — `normalizeHomeworks`). */
  homeworks?: unknown[]
}

export interface ReportTopic {
  topic_id: string
  title: string
  subject: string
  ege_numbers: number[]
  tasks_counted: number
  correct_percent: number
}

export interface ProgressReport {
  student: { id: string; full_name: string; grade: number | null; groups: string[] }
  period: { from: string; to: string }
  generated_at: string
  min_group_for_avg: number
  min_tasks_for_topic: number
  subjects: ReportSubject[]
  mocks: ReportMock[]
  topics: { weak: ReportTopic[]; strong: ReportTopic[]; without_number: number }
  ege_numbers: { number: number; tasks_counted: number; correct_percent: number }[]
  activity: {
    video_seconds: number
    video_seconds_last_week: number
    materials: number
    catalog_tasks: number
    with_due: number
    on_time: number
    late: number
  }
  next_steps: string[]
  /**
   * Внутренняя заметка преподавателя. Едет на ЭКРАН и только туда:
   * `ParentReportSheet` про это поле не знает вовсе (§217, правило владельца —
   * не прятать стилем, а не отрисовывать).
   */
  teacher_note: { body: string; created_at: string } | null
  /** §261: свидетельства прогноза на конец периода — тот же ответ, что `student_exam_forecast_evidence()`. */
  forecast?: unknown
  /** §261: «Старание за период». Поля нет — база до §261, блок печатает прочерки. */
  diligence?: ReportDiligence
}

export interface ReportDiligence {
  solve_days: number
  period_days: number
  streak: number
  catalog_correct: number
  achievements_earned: number
  achievements_total: number
  level: { n: number; name: string } | null
  levels_count: number
}

/** Прочерк. Один символ на весь отчёт, чтобы он не разъехался по файлам. */
export const DASH = '—'

export interface Printable {
  /** Что печатать крупно: число с единицей либо прочерк. */
  value: string
  /** Подпись под числом. Она обязательна — см. ниже про число работ. */
  note: string
  /** Прочерк ли это: у прочерка подпись оформляется иначе. */
  dashed: boolean
}

/**
 * Средний балл. Правило владельца: он НИКОГДА не едет один — под цифрой
 * всегда стоит «по 7 проверенным работам». Без числа работ «100 %» по одной
 * работе читается родителем как готовность к экзамену.
 */
export function averageScore(avgPercent: number | null, gradedWorks: number): Printable {
  if (avgPercent == null || gradedWorks <= 0) {
    return { value: DASH, note: 'проверенных работ за период нет', dashed: true }
  }
  return {
    value: `${avgPercent} %`,
    note: `по ${gradedWorks} ${plural(gradedWorks, 'проверенной работе', 'проверенным работам', 'проверенным работам')}`,
    dashed: false,
  }
}

/**
 * Среднее по группе. Печатается, только когда в группе шесть человек и
 * больше; меньше — прочерк С ПОЯСНЕНИЕМ, а не пустое место. Пояснение нужно
 * ровно затем, чтобы родитель не решил, что цифру забыли.
 */
export function groupAverage(avgPercent: number | null, groupSize: number): Printable {
  if (groupSize < MIN_GROUP_FOR_AVG) {
    return {
      value: DASH,
      note: `в группе ${groupSize} ${plural(groupSize, 'человек', 'человека', 'человек')}, среднее не печатаем`,
      dashed: true,
    }
  }
  if (avgPercent == null) {
    return { value: DASH, note: 'проверенных работ в группе за период нет', dashed: true }
  }
  return {
    value: `${avgPercent} %`,
    note: `${groupSize} ${plural(groupSize, 'человек', 'человека', 'человек')} в группе`,
    dashed: false,
  }
}

/** Цель по предмету (§216). Нет цели — прочерк, а НЕ ноль. */
export function targetLabel(target: number | null): string {
  return target == null ? `цель на экзамене ${DASH} не задана` : `цель на экзамене — ${target} баллов`
}

/** Состав работ одной строкой: «принято 7 · на доработке 1 · ждёт проверки 1». */
export function worksBreakdown(works: ReportSubject['works']): string {
  const parts: string[] = []
  if (works.accepted) parts.push(`принято ${works.accepted}`)
  if (works.revision) parts.push(`на доработке ${works.revision}`)
  if (works.pending) parts.push(`ждёт проверки ${works.pending}`)
  return parts.join(' · ') || 'работ за период нет'
}

/** «12 / 14» и подпись про опоздания. */
export function onTime(onTimeCount: number, withDue: number, late: number): Printable {
  if (withDue === 0) {
    return { value: DASH, note: 'у работ периода не проставлен срок', dashed: true }
  }
  return {
    value: `${onTimeCount} / ${withDue}`,
    note: late > 0
      ? `${late} ${plural(late, 'работа', 'работы', 'работ')} с опозданием`
      : 'все работы в срок',
    dashed: false,
  }
}

/** «3 ч 20 м» — время просмотра видео. Ноль печатается честным нулём. */
export function watchTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} м`
  return `${hours} ч ${minutes} м`
}

/**
 * Номера заданий ЕГЭ рядом с темой (§216). Номеров бывает несколько, и тогда
 * они печатаются списком; номера нет — так и написано, а не пусто: владельцу
 * предстоит проставлять их руками, и «без номера» — это подсказка ему.
 */
export function egeTagLabel(numbers: number[] | null | undefined): string {
  if (!numbers || numbers.length === 0) return 'без номера'
  return `№${numbers.join(', ')}`
}

/** «посчитано на 9 заданиях» — число, на котором стоит процент по теме. */
export function topicBasis(tasksCounted: number): string {
  return `${tasksCounted} ${plural(tasksCounted, 'задание', 'задания', 'заданий')}`
}

/**
 * Темы для списка. База уже отфильтровала и порезала, но порог здесь
 * повторён: если он когда-нибудь разойдётся, лучше показать меньше тем, чем
 * назвать «слабой» тему, посчитанную на двух заданиях.
 */
export function topicsForList(topics: readonly ReportTopic[] | null | undefined): ReportTopic[] {
  return (topics ?? []).filter(t => t.tasks_counted >= MIN_TASKS_FOR_TOPIC)
}

export interface SparkPoint { x: number; y: number; label: string }

/**
 * Точки маленького графика «средний балл по неделям». Обычный SVG, без
 * зависимостей: график на два десятка точек не стоит библиотеки.
 *
 * Шкала фиксированная 0..100, а не «по минимуму и максимуму»: подвижная
 * шкала превращает колебание в три процента в отвесный подъём, и родитель
 * читает картинку, а не числа.
 */
export function sparkPoints(weeks: readonly ReportWeek[], width: number, height: number): SparkPoint[] {
  if (weeks.length === 0) return []
  const pad = 8
  const usableW = Math.max(1, width - pad * 2)
  const usableH = Math.max(1, height - pad * 2)
  const step = weeks.length === 1 ? 0 : usableW / (weeks.length - 1)
  return weeks.map((w, i) => ({
    x: Math.round((pad + step * i) * 10) / 10,
    y: Math.round((pad + usableH * (1 - Math.min(100, Math.max(0, w.avg_percent)) / 100)) * 10) / 10,
    label: String(w.avg_percent),
  }))
}

/** `points="x,y x,y"` для `<polyline>`. */
export function polylinePoints(points: readonly SparkPoint[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ')
}

/** «01.09 — 25.09.2026». Период печатается в шапке обоих листов. */
export function formatPeriod(from: string, to: string): string {
  const f = from.slice(0, 10).split('-')
  const t = to.slice(0, 10).split('-')
  if (f.length !== 3 || t.length !== 3) return `${from} — ${to}`
  return `${f[2]}.${f[1]} — ${t[2]}.${t[1]}.${t[0]}`
}

/** «12.06» — короткая дата в таблице пробников. */
export function formatShortDate(value: string): string {
  const parts = value.slice(0, 10).split('-')
  return parts.length === 3 ? `${parts[2]}.${parts[1]}` : value
}

/** «25.09.2026» — дата составления отчёта. */
export function formatFullDate(value: string): string {
  const parts = value.slice(0, 10).split('-')
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value
}

/** «+6» / «−4» — прирост к предыдущему пробнику. Ноль печатается нулём. */
export function formatDelta(delta: number | null): string | null {
  if (delta == null) return null
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return '0'
}

/**
 * Предметы в порядке, понятном человеку: по русскому названию. База отдаёт их
 * по коду (`math` раньше `physics`), и на листе это выглядело бы случайным.
 */
export function sortSubjects(subjects: readonly ReportSubject[], label: (s: string) => string): ReportSubject[] {
  return [...subjects].sort((a, b) => label(a.subject).localeCompare(label(b.subject), 'ru'))
}

/** Три строки «что делать»: пустые не печатаются пустыми пунктами списка. */
export function cleanSteps(steps: readonly string[] | null | undefined): string[] {
  return (steps ?? []).map(s => (s ?? '').trim()).filter(Boolean).slice(0, 3)
}

// ── §261: новые плитки листа 1 ───────────────────────────────────────────

export function subjectAssessments(subject: ReportSubject): AssessmentRow[] {
  return normalizeAssessments(subject.assessments)
}

export function subjectHomeworks(subject: ReportSubject): HomeworkRow[] {
  return normalizeHomeworks(subject.homeworks)
}

/**
 * «Средний балл ДЗ»: средняя оценка принятых ДЗ уроков периода (пятибалльные отдельно от стобалльных) — всегда с
 * числом работ (правило владельца §217). ДЗ периода нет в ответе (база до §261) — прежний средний процент.
 */
export function homeworkAverage(subject: ReportSubject): Printable {
  if (!Array.isArray(subject.homeworks)) return averageScore(subject.avg_percent, subject.graded_works)
  const avg = gradeAverage(subjectHomeworks(subject).filter(r => r.status === 'accepted'))
  if (!avg) return { value: DASH, note: 'проверенных ДЗ за период нет', dashed: true }
  return {
    value: formatGrade(avg.value, avg.scale),
    note: `${avg.count} ${plural(avg.count, 'проверенная работа', 'проверенные работы', 'проверенных работ')}`,
    dashed: false,
  }
}

/** «Проверочные»: «4,0 · 3 работы · класс 3,9» (класс — только если база его отдала: в классе от шести). */
export function assessmentsCell(subject: ReportSubject): Printable {
  const s = assessmentSummary(subjectAssessments(subject))
  if (!s.avg) return { value: DASH, note: 'проверочных с оценкой за период нет', dashed: true }
  const parts = [worksWord(s.avg.count)]
  if (s.classAvg != null) parts.push(`класс ${formatGrade(s.classAvg, s.avg.scale)}`)
  return { value: formatGrade(s.avg.value, s.avg.scale), note: parts.join(' · '), dashed: false }
}

/** «ДЗ вовремя»: «12 из 14» — правилом §259 (первая сдача против срока по Москве), ДЗ со сроком в периоде. */
export function homeworkOnTimeCell(subject: ReportSubject, nowMs: number): Printable {
  const s = homeworkDeadlineSummary(subjectHomeworks(subject), nowMs)
  if (s.total === 0) return { value: DASH, note: 'сроков ДЗ в этом периоде не было', dashed: true }
  return { value: `${s.ontime} из ${s.total}`, note: deadlineNote(s, ', '), dashed: false }
}
