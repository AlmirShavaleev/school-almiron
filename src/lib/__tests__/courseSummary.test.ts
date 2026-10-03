import { describe, expect, it } from 'vitest'
import { buildForecastView, forecastAt, normalizeForecastResponse } from '@/lib/egeForecast'
import { activeSpec } from '@/lib/egeScales'
import {
  deltaText, lastMarks, normalizeCourseSummary, saggedReason, seenText, sortStudents, summaryHeader, weakNumbers,
  type SummaryStudent,
} from '@/lib/courseSummary'
import { normalizeAssessments } from '@/lib/studentOverview'

/**
 * §264. «Сводка» класса — разбор ответа `course_summary_for_staff` и расчёты по нему: прогноз той же моделью §255
 * (и «мало данных» по тому же правилу покрытия), «просел за неделю», «ДЗ вовремя» по правилу §259, сортировка.
 */

/** 5 октября 2026, 12:00 МСК. */
const NOW_ISO = '2026-10-05T09:00:00Z'
const NOW = Date.parse(NOW_ISO)
const DAY = 86_400_000
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()
const TODAY = '2026-10-05'

/** Свидетельства базы в компактном виде [ns, source, score, at, kim_total]: k задач ДЗ по каждому номеру. */
function ev(ns: number[], { k = 3, daysAgo = 2, score = 1 }: { k?: number; daysAgo?: number; score?: number } = {}) {
  return ns.flatMap(n => Array.from({ length: k }, () => [[n], 'hw', score, ago(daysAgo), null]))
}
const fc = (evidence: unknown[], numbers: unknown[] = []) => ({ now: NOW_ISO, subjects: [{ subject: 'physics', goal: null, teacher_goal: null }], numbers, ev: evidence })
const P1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function student(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    student_id: id, name, forecast: fc([]), assessments: [], homeworks: [],
    catalog: { days: 7, tried: 0, correct: 0 }, streak: 0, solved_today: false,
    last_solved: '2026-10-04', last_seen: '2026-10-05', ...over,
  }
}
function summary(students: unknown[], over: Record<string, unknown> = {}) {
  return {
    course: { id: 'c-1', title: 'Физика ЕГЭ 10А', subject: 'physics', exam_type: 'ege' },
    now: NOW_ISO, today: TODAY, forecast_enabled: true,
    titles: [{ subject: 'physics', n: 4, title: 'Силы', section_id: 's-4' }],
    students, ...over,
  }
}

describe('прогноз — та же модель §255', () => {
  it('покрытие есть — балл и «за 30 дн.» совпадают с buildForecastView над теми же свидетельствами', () => {
    const raw = summary([student('s-1', 'Шарипов К.', { forecast: fc(ev(P1)) })])
    const s = normalizeCourseSummary(raw)!.students[0]
    const ref = normalizeForecastResponse({
      now: NOW_ISO, subjects: [{ subject: 'physics' }], titles: [], numbers: [],
      evidence: ev(P1).map(([ns, source, score, at]) => ({ subject: 'physics', ns, source, score, at })),
    })!
    const view = buildForecastView(activeSpec('physics')!, ref.evidence, ref.now)
    expect(s.forecast).toMatchObject({ kind: 'ready', score: view.score, monthDelta: view.monthDelta })
  })
  it('покрытия не хватает — «мало данных»; курс не ЕГЭ — прогноза нет вовсе', () => {
    const few = normalizeCourseSummary(summary([student('s-1', 'А', { forecast: fc(ev([1, 2])) })]))!
    expect(few.students[0].forecast.kind).toBe('few')
    const oge = normalizeCourseSummary(summary([student('s-1', 'А', { forecast: null })], { forecast_enabled: false }))!
    expect(oge.students[0].forecast.kind).toBe('none')
    expect(oge.students[0].weak).toEqual([])
  })
})

describe('«просел за неделю»', () => {
  it('прогноз упал по сравнению с моментом 7 дней назад', () => {
    // неделю назад всё решал верно; за последние 3 дня — много неверных
    const evidence = [...ev(P1, { daysAgo: 10 }), ...ev(P1, { daysAgo: 1, k: 4, score: 0 })]
    const s = normalizeCourseSummary(summary([student('s-1', 'Мурин А.', { forecast: fc(evidence) })]))!.students[0]
    expect(s.forecast.kind).toBe('ready')
    expect(s.forecastDrop).toBeGreaterThan(0)
    expect(s.sagged).toBe(true)
    expect(s.idle7).toBe(false)
    expect(saggedReason(s)).toMatch(/^прогноз −\d+ за неделю$/)
  })
  it('за 7 дней ни одного дня с решением (граница — 6 дней назад ещё считается)', () => {
    const mk = (last: string | null) => normalizeCourseSummary(summary([student('s', 'А', { last_solved: last })]))!.students[0]
    expect(mk('2026-09-29').idle7).toBe(false)
    expect(mk('2026-09-28').idle7).toBe(true)
    expect(mk(null).sagged).toBe(true)
    expect(saggedReason(mk(null))).toBe('за 7 дней ни одной сдачи и решения')
  })
  it('рост прогноза и решения на неделе — не «просел»', () => {
    const evidence = [...ev(P1, { daysAgo: 10, score: 0.5 }), ...ev(P1, { daysAgo: 1 })]
    const s = normalizeCourseSummary(summary([student('s-1', 'А', { forecast: fc(evidence) })]))!.students[0]
    expect(s.forecastDrop).toBeNull()
    expect(s.sagged).toBe(false)
    const spec = activeSpec('physics')!
    const data = normalizeForecastResponse({ now: NOW_ISO, subjects: [{ subject: 'physics' }], evidence: evidence.map(([ns, source, score, at]) => ({ subject: 'physics', ns, source, score, at })) })!
    expect(forecastAt(spec, data.evidence, new Date(NOW - 7 * DAY)).ready).toBe(true)
  })
})

describe('колонки', () => {
  it('ДЗ вовремя k/n — правило §259: первая сдача по Москве против срока; срок впереди — не в счёт', () => {
    const homeworks = [
      { title: 'ДЗ 1', subject: 'physics', exam_type: 'ege', due_at: '2026-09-30', first_submitted_at: '2026-09-30T20:40:00Z', status: 'accepted', score: 5 }, // 23:40 МСК — вовремя
      { title: 'ДЗ 2', subject: 'physics', exam_type: 'ege', due_at: '2026-09-30', first_submitted_at: '2026-09-30T21:00:00Z', status: 'accepted', score: 4 }, // 00:00 МСК — опоздание
      { title: 'ДЗ 3', subject: 'physics', exam_type: 'ege', due_at: '2026-10-01', first_submitted_at: null, status: null, score: null }, // не сдано
      { title: 'ДЗ 4', subject: 'physics', exam_type: 'ege', due_at: '2026-10-09', first_submitted_at: null, status: null, score: null }, // впереди
    ]
    const s = normalizeCourseSummary(summary([student('s', 'А', { homeworks })]))!.students[0]
    expect([s.hwOnTime, s.hwTotal]).toEqual([1, 3])
  })
  it('проверочные — последние три по дате, слева старая; «не писал», «ждёт»', () => {
    const rows = normalizeAssessments([
      { title: 'П1', date: '2026-09-01', status: 'accepted', score: 3, grade_scale: 'five' },
      { title: 'П2', date: '2026-09-10', status: 'accepted', score: 5, grade_scale: 'five' },
      { title: 'П3', date: '2026-09-20', status: null, score: null, grade_scale: 'five' },
      { title: 'П4', date: '2026-09-30', status: 'submitted', score: null, grade_scale: 'five' },
    ])
    expect(lastMarks(rows).map(m => m.text)).toEqual(['5', '—', 'ждёт'])
    expect(lastMarks(rows).map(m => m.tone)).toEqual(['five', 'missed', 'wait'])
  })
  it('слабые номера: с данными, «рост» раньше «прогресса», по доле верного, до трёх; название — из ответа', () => {
    const numbers = [
      { n: 1, zone: 'confident', share: 0.9 }, { n: 4, zone: 'growth', share: 0.3 }, { n: 7, zone: 'progress', share: 0.5 },
      { n: 10, zone: 'growth', share: 0.2 }, { n: 8, zone: 'progress', share: 0.45 }, { n: 2, zone: 'growth', share: null },
    ]
    const s = normalizeCourseSummary(summary([student('s', 'А', { forecast: fc([], numbers) })]))!.students[0]
    expect(s.weak.map(w => [w.n, w.zone])).toEqual([[10, 'growth'], [4, 'growth'], [8, 'progress']])
    expect(s.weak.find(w => w.n === 4)?.title).toBe('Силы')
    expect(weakNumbers(null, 'physics')).toEqual([])
  })
  it('«был»: сегодня, вчера, N дней назад, не заходил; изменение за 30 дней со знаком', () => {
    expect(seenText('2026-10-05', TODAY)).toBe('сегодня')
    expect(seenText('2026-10-04', TODAY)).toBe('вчера')
    expect(seenText('2026-10-02', TODAY)).toBe('3 дня назад')
    expect(seenText('2026-09-23', TODAY)).toBe('12 дней назад')
    expect(seenText(null, TODAY)).toBe('не заходил')
    expect([deltaText(8), deltaText(-3), deltaText(0), deltaText(null)]).toEqual(['+8', '−3', '0', '—'])
  })
})

describe('шапка и сортировка', () => {
  const data = normalizeCourseSummary(summary([
    student('s-1', 'Шарипов К.', { forecast: fc(ev(P1)), streak: 12, catalog: { tried: 25, correct: 21 }, last_seen: '2026-10-05',
      assessments: [{ title: 'П', date: '2026-09-20', status: 'accepted', score: 5, grade_scale: 'five' }],
      homeworks: [{ title: 'Д', due_at: '2026-09-30', first_submitted_at: '2026-09-29T10:00:00Z', status: 'accepted' }] }),
    student('s-2', 'Аминов А.', { forecast: fc([]), streak: 0, last_seen: '2026-09-23', last_solved: '2026-09-20',
      assessments: [{ title: 'П', date: '2026-09-20', status: null, grade_scale: 'five' }],
      homeworks: [{ title: 'Д', due_at: '2026-09-30', first_submitted_at: null, status: null }] }),
    student('s-3', 'Газизов И.', { forecast: fc(ev(P1, { score: 0.5 })), streak: 4, catalog: { tried: 9, correct: 9 }, last_seen: '2026-10-05',
      assessments: [{ title: 'П', date: '2026-09-20', status: 'accepted', score: 4, grade_scale: 'five' }] }),
  ]))!
  it('шапка: прогноз ср. по тем, у кого он есть; ДЗ вовремя %; проверочные ср.; просели', () => {
    const h = summaryHeader(data.students)
    const ready = data.students.flatMap(s => (s.forecast.kind === 'ready' ? [s.forecast.score] : []))
    expect(h.forecastCount).toBe(2)
    expect(h.forecastAvg).toBe(Math.round((ready[0] + ready[1]) / 2))
    expect(h.hwOnTimePct).toBe(50)
    expect(h.assessAvg?.value).toBe(4.5)
    expect(h.sagged).toBe(1)
  })
  it('по прогнозу: большие сверху, «мало данных» — всегда внизу; повторное нажатие — обратный порядок', () => {
    const names = (l: SummaryStudent[]) => l.map(s => s.name)
    expect(names(sortStudents(data.students, 'forecast', 'desc'))).toEqual(['Шарипов К.', 'Газизов И.', 'Аминов А.'])
    expect(names(sortStudents(data.students, 'forecast', 'asc'))).toEqual(['Газизов И.', 'Шарипов К.', 'Аминов А.'])
  })
  it('по имени, серии, каталогу, «был», ДЗ вовремя', () => {
    const names = (l: SummaryStudent[]) => l.map(s => s.name)
    expect(names(sortStudents(data.students, 'name', 'asc'))).toEqual(['Аминов А.', 'Газизов И.', 'Шарипов К.'])
    expect(names(sortStudents(data.students, 'streak', 'desc'))).toEqual(['Шарипов К.', 'Газизов И.', 'Аминов А.'])
    expect(names(sortStudents(data.students, 'catalog', 'desc'))).toEqual(['Шарипов К.', 'Газизов И.', 'Аминов А.'])
    expect(names(sortStudents(data.students, 'seen', 'desc'))).toEqual(['Газизов И.', 'Шарипов К.', 'Аминов А.'])
    expect(names(sortStudents(data.students, 'homework', 'desc'))).toEqual(['Шарипов К.', 'Аминов А.', 'Газизов И.'])
  })
  it('мусор в ответе не роняет разбор', () => {
    expect(normalizeCourseSummary(null)).toBeNull()
    expect(normalizeCourseSummary({ course: {} })).toBeNull()
    const d = normalizeCourseSummary({ course: { id: 'c' }, students: [null, { name: 'без id' }, { student_id: 's', forecast: 'x', ev: 5 }] })!
    expect(d.students).toHaveLength(1)
    expect(d.students[0].forecast.kind).toBe('none')
  })
})
