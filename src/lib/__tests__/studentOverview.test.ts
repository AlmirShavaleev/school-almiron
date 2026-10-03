import { describe, expect, it } from 'vitest'
import { buildForecastView, normalizeForecastResponse } from '@/lib/egeForecast'
import { EGE_SPECS } from '@/lib/egeScales'
import {
  activityCells, assessmentSummary, bySubject, defaultSubjectKey, deadlineNote, forecastSummary, formatGrade,
  gradeAverage, homeworkDeadlineSummary, normalizeOverview, overviewTiles, pointsLabel, recentHomeworks, zoneCells,
  zoneLegend, type HomeworkRow,
} from '@/lib/studentOverview'

/**
 * §261. «Ученик целиком» — сборка плиток и блоков карточки учителя из ответа `student_overview_for_staff`.
 * Поведение: пустой ответ, мало данных для прогноза, полный ответ; прогноз — только при покрытии (правило §255);
 * «вовремя» — правило §259 (первая сдача по Москве против срока); проверочные — баллы есть/нет, средняя класса.
 */

/** 3 октября 2026, 12:00 МСК. */
const NOW_ISO = '2026-10-03T09:00:00Z'
const NOW = Date.parse(NOW_ISO)
const DAY = 86_400_000
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

/** Ответ базы прогноза: по `k` верных задач ДЗ на каждый номер из `ns` (physics — часть 1 №1–20, нужно 10). */
function rawForecast(opts: { subject?: string; ns?: number[]; k?: number; daysAgo?: number; goal?: number | null; teacherGoal?: number | null } = {}) {
  const { subject = 'physics', ns = [], k = 3, daysAgo = 2, goal = null, teacherGoal = null } = opts
  let i = 0
  const evidence = ns.flatMap(n => Array.from({ length: k }, () => ({
    subject, ns: [n], source: 'hw', score: 1, at: ago(daysAgo), item: `hw:${++i}`, kim_total: null,
  })))
  return {
    now: NOW_ISO,
    today: '2026-10-03',
    subjects: [{ subject, goal, teacher_goal: teacherGoal }],
    titles: [],
    numbers: [
      { subject, n: 1, zone: 'confident', share: 0.86, solved: 3 },
      { subject, n: 4, zone: 'growth', share: 0.3, solved: 0 },
      { subject, n: 3, zone: 'progress', share: 0.55, solved: 1 },
    ],
    catalog_rules: {
      window_days: 60, low: 0.4, high: 0.7,
      zones: [{ key: 'growth', per_task: 5, milestones: [] }, { key: 'progress', per_task: 3, milestones: [] }, { key: 'confident', per_task: 1, milestones: [] }],
    },
    evidence,
  }
}

const FULL = {
  student_id: 'st-1',
  today: '2026-10-03',
  now: NOW_ISO,
  subjects: [{ subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ 10А' }],
  forecast: rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], goal: 75 }),
  activity: {
    streak: 5, record: 12, solved_today: true,
    days: ['2026-10-03', '2026-10-02', '2026-09-30', '2026-09-20', '2026-09-19'],
    daily: { days: 14, assigned: 14, done: 6 },
    weekly: [{ subject: 'physics', week_start: '2026-09-28', numbers: [4, 10], target: 10, progress: 7 }],
    catalog: { total: 47, week: { days: 7, tried: 12, correct: 9 } },
  },
  achievements: { total: 79, earned: 23, latest: [{ key: 'catalog:20', category: 'catalog', threshold: 20 }] },
  points: { total: 1100, level: { n: 7, name: 'Опыт' }, levels_count: 20 },
  assessments: [
    { title: 'Движение по окружности', subject: 'physics', exam_type: 'ege', kind: 'check', date: '2026-10-03', status: 'accepted', score: 4, grade_scale: 'five', points: 10, points_max: 12, class_avg: 4.0, class_size: 7 },
    { title: 'Кинематика: броски', subject: 'physics', exam_type: 'ege', kind: 'control', date: '2026-09-26', status: 'accepted', score: 4, grade_scale: 'five', points: null, points_max: null, class_avg: 3.9, class_size: 7 },
    { title: 'Равномерное движение', subject: 'physics', exam_type: 'ege', kind: 'check', date: '2026-09-19', status: 'accepted', score: 5, grade_scale: 'five', points: 11, points_max: 12, class_avg: 4.2, class_size: 7 },
    { title: 'Статика', subject: 'physics', exam_type: 'ege', kind: 'check', date: '2026-10-01', status: null, score: null, grade_scale: 'five', points: null, points_max: null, class_avg: 3.5, class_size: 7 },
  ],
  homeworks: [
    // вовремя: сдано 1 окт 23:40 МСК при сроке 1 окт
    { title: 'Динамика', subject: 'physics', exam_type: 'ege', due_at: '2026-10-01', first_submitted_at: '2026-10-01T20:40:00Z', status: 'accepted', score: 5, grade_scale: 'five' },
    // опоздание: 00:00 МСК 30 сент при сроке 29 сент
    { title: 'Силы', subject: 'physics', exam_type: 'ege', due_at: '2026-09-29', first_submitted_at: '2026-09-29T21:00:00Z', status: 'accepted', score: 4, grade_scale: 'five' },
    // не сдано, срок прошёл
    { title: 'Кинематика. Теория', subject: 'physics', exam_type: 'ege', due_at: '2026-09-22', first_submitted_at: null, status: null, score: null, grade_scale: 'five' },
    // срок впереди — не «не сдано»
    { title: 'Импульс', subject: 'physics', exam_type: 'ege', due_at: '2026-10-07', first_submitted_at: null, status: null, score: null, grade_scale: 'five' },
    // сдано, ждёт проверки
    { title: 'Относительность', subject: 'physics', exam_type: 'ege', due_at: '2026-09-18', first_submitted_at: '2026-09-17T10:00:00Z', status: 'submitted', score: null, grade_scale: 'five' },
  ],
  next_steps: { period_from: '2026-09-01', period_to: '2026-10-03', steps: ['№4 и №10 — по 10 задач', '  ', 'Сдать «Кинематику»'] },
}

const EMPTY = {
  student_id: 'st-2', today: '2026-10-03', now: NOW_ISO,
  subjects: [{ subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ 10В' }],
  forecast: rawForecast(),
  activity: { streak: 0, record: 0, solved_today: false, days: [], daily: { days: 14, assigned: 0, done: 0 }, weekly: [], catalog: { total: 0, week: { days: 7, tried: 0, correct: 0 } } },
  achievements: { total: 79, earned: 0, latest: [] },
  points: { total: 0, level: { n: 1, name: 'Старт' }, levels_count: 20 },
  assessments: [], homeworks: [], next_steps: null,
}

const tile = (tiles: ReturnType<typeof overviewTiles>, key: string) => tiles.find(t => t.key === key)!

describe('ответ базы → карточка', () => {
  it('полный ответ разбирается; пустые строки «что делать» отбрасываются', () => {
    const o = normalizeOverview(FULL)!
    expect(o.now.toISOString()).toBe('2026-10-03T09:00:00.000Z')
    expect(o.assessments).toHaveLength(4)
    expect(o.homeworks).toHaveLength(5)
    expect(o.level).toEqual({ n: 7, name: 'Опыт', count: 20 })
    expect(o.achievements?.earned).toBe(23)
    expect(o.nextSteps?.steps).toEqual(['№4 и №10 — по 10 задач', 'Сдать «Кинематику»'])
    expect(o.forecast?.evidence.length).toBe(36)
  })

  it('мусор вместо ответа — null, а не исключение', () => {
    expect(normalizeOverview(null)).toBeNull()
    expect(normalizeOverview('x')).toBeNull()
    const o = normalizeOverview({ now: NOW_ISO })!
    expect(o.assessments).toEqual([])
    expect(o.forecast).toBeNull()
    expect(o.nextSteps).toBeNull()
  })
})

describe('плитки: пусто / мало данных / полно', () => {
  it('ученик без данных — прочерки, без выдуманных нулей в оценках', () => {
    const o = normalizeOverview(EMPTY)!
    const t = overviewTiles(o, 'physics:ege')
    expect(t.map(x => x.label)).toEqual(['Примерный балл ЕГЭ', 'Проверочные', 'ДЗ вовремя', 'Средний за ДЗ', 'Каталог', 'Серия'])
    expect(tile(t, 'forecast')).toMatchObject({ value: '—', dashed: true, note: 'мало данных: 0 из 10 номеров части 1' })
    expect(tile(t, 'assessments')).toMatchObject({ value: '—', dashed: true, note: 'оценок за проверочные пока нет' })
    expect(tile(t, 'ontime')).toMatchObject({ value: '—', dashed: true })
    expect(tile(t, 'hw')).toMatchObject({ value: '—', dashed: true })
    expect(tile(t, 'catalog').value).toBe('0')
    expect(tile(t, 'streak')).toMatchObject({ value: '0 дн.', note: 'рекорд 0 · уровень 1 «Старт»' })
  })

  it('мало данных для прогноза: 9 из 10 номеров физики — балла нет, «мало данных»', () => {
    const o = normalizeOverview({ ...FULL, forecast: rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9], goal: 75 }) })!
    const f = tile(overviewTiles(o, 'physics:ege'), 'forecast')
    expect(f.value).toBe('—')
    expect(f.note).toBe('мало данных: 9 из 10 номеров части 1')
    expect(f.bar).toBeUndefined()
  })

  it('полный ответ: балл той же моделью, что у ученика, цель ученика на полосе', () => {
    const o = normalizeOverview(FULL)!
    const t = overviewTiles(o, 'physics:ege')
    const expected = buildForecastView(EGE_SPECS['physics:2026'], o.forecast!.evidence, o.forecast!.now)
    expect(tile(t, 'forecast')).toMatchObject({ value: String(expected.score), dashed: false, bar: { value: expected.score, goal: 75 } })
    expect(tile(t, 'forecast').note.startsWith('цель 75')).toBe(true)
    // проверочные: 4, 4, 5 → 4,3; класс по тем же трём работам (4,0 + 3,9 + 4,2) / 3 = 4,03 → «4,0»
    expect(tile(t, 'assessments')).toMatchObject({ value: '4,3', note: '3 работы · класс 4,0' })
    // ДЗ: вовремя 2 (Динамика, Относительность), опоздание 1, не сдано 1; «Импульс» — срок впереди
    expect(tile(t, 'ontime')).toMatchObject({ value: '2 / 4', note: '1 с опозданием · 1 не сдано' })
    expect(tile(t, 'hw')).toMatchObject({ value: '4,5', note: '2 проверенных' })
    expect(tile(t, 'catalog')).toMatchObject({ value: '47', note: 'верно с проверкой · 9 за неделю' })
    expect(tile(t, 'streak')).toMatchObject({ value: '5 дн.', note: 'рекорд 12 · уровень 7 «Опыт»' })
  })

  it('не ЕГЭ (математика ОГЭ) — прогноза нет вовсе', () => {
    const o = normalizeOverview({ ...FULL, subjects: [{ subject: 'math', exam_type: 'oge', course_titles: 'ОГЭ' }] })!
    expect(tile(overviewTiles(o, 'math:oge'), 'forecast')).toMatchObject({ value: '—', note: 'только для ЕГЭ по математике и физике' })
  })
})

describe('прогноз только при покрытии (правило §255)', () => {
  it('нет данных → none; мало → few; хватает → ready с «до цели»', () => {
    expect(forecastSummary(null, 'physics')).toEqual({ kind: 'none' })
    expect(forecastSummary(normalizeForecastResponse(rawForecast()), 'math')).toEqual({ kind: 'none' })
    const few = forecastSummary(normalizeForecastResponse(rawForecast({ ns: [1, 2] })), 'physics')
    expect(few).toMatchObject({ kind: 'few', covered: 2, need: 10, missing: 8 })
    const ready = forecastSummary(normalizeForecastResponse(rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], goal: 90 })), 'physics')
    expect(ready.kind).toBe('ready')
    if (ready.kind === 'ready') expect(ready.toGoal).toBe(90 - ready.score)
  })

  it('цели ученика нет — берётся цель учителя; нет никакой — null', () => {
    const data = normalizeForecastResponse(rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], teacherGoal: 70 }))
    expect(forecastSummary(data, 'physics', 70)).toMatchObject({ kind: 'ready', goal: 70 })
    expect(forecastSummary(data, 'physics', null)).toMatchObject({ kind: 'ready', goal: null, toGoal: null })
  })

  it('«+N за месяц» — только если и месяц назад балл показывался', () => {
    const now = normalizeForecastResponse(rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], daysAgo: 2 }))!
    const r = forecastSummary(now, 'physics')
    expect(r.kind === 'ready' && r.monthDelta).toBeNull()
    const old = normalizeForecastResponse(rawForecast({ ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], daysAgo: 40 }))!
    const r2 = forecastSummary(old, 'physics')
    expect(r2.kind === 'ready' && typeof r2.monthDelta).toBe('number')
  })
})

describe('проверочные: баллы есть / нет, средняя класса', () => {
  const o = normalizeOverview(FULL)!
  it('«10 из 12» — только где учитель ставил баллы по критериям; ½ печатается дробью', () => {
    expect(pointsLabel(o.assessments[0].points, o.assessments[0].pointsMax)).toBe('10 из 12')
    expect(pointsLabel(o.assessments[1].points, o.assessments[1].pointsMax)).toBeNull()
    expect(pointsLabel(0.5, 1)).toBe('½ из 1')
    expect(pointsLabel(7.5, 12)).toBe('7,5 из 12')
  })

  it('средняя класса — по тем же работам, что у ученика (ненаписанная «Статика» не входит)', () => {
    const s = assessmentSummary(o.assessments)
    expect(s.avg).toMatchObject({ count: 3, scale: 'five' })
    expect(s.classAvg).toBeCloseTo((4.0 + 3.9 + 4.2) / 3, 5)
  })

  it('пятибалльные и стобалльные в одну среднюю не складываются', () => {
    expect(gradeAverage([{ score: 5, gradeScale: 'five' }, { score: 90, gradeScale: 'hundred' }])).toEqual({ value: 5, count: 1, scale: 'five' })
    expect(gradeAverage([{ score: 90, gradeScale: 'hundred' }, { score: 70, gradeScale: 'hundred' }])).toEqual({ value: 80, count: 2, scale: 'hundred' })
    expect(gradeAverage([{ score: null, gradeScale: 'five' }])).toBeNull()
    expect(formatGrade(4.25)).toBe('4,3')
    expect(formatGrade(4)).toBe('4,0')
    expect(formatGrade(78.4, 'hundred')).toBe('78')
  })
})

describe('ДЗ вовремя — через §259', () => {
  const rows = normalizeOverview(FULL)!.homeworks

  it('первая сдача по Москве против срока; срок впереди не считается «не сдано»', () => {
    const s = homeworkDeadlineSummary(rows, NOW)
    expect(s).toEqual({ ontime: 2, late: 1, missing: 1, total: 4 })
    expect(deadlineNote(s)).toBe('1 с опозданием · 1 не сдано')
    expect(deadlineNote({ ontime: 3, late: 0, missing: 0, total: 3 })).toBe('все вовремя')
  })

  it('последние 6 — по сроку от новых к старым, подписи §259', () => {
    const v = recentHomeworks(rows, NOW)
    expect(v.map(h => h.row.title)).toEqual(['Импульс', 'Динамика', 'Силы', 'Кинематика. Теория', 'Относительность'])
    expect(v.map(h => h.label)).toEqual(['ещё 4 дн.', 'вовремя', 'опоздание 1 дн.', 'просрочено 11 дн.', 'вовремя'])
    expect(v.map(h => h.scoreText)).toEqual(['—', '5', '4', '—', 'ждёт'])
    const many: HomeworkRow[] = Array.from({ length: 9 }, (_, i) => ({
      title: `ДЗ ${i}`, subject: 'physics', examType: 'ege', dueAt: `2026-09-0${i + 1}`, firstSubmittedAt: null, status: null, score: null, gradeScale: 'five',
    }))
    expect(recentHomeworks(many, NOW)).toHaveLength(6)
    expect(recentHomeworks(many, NOW)[0].row.title).toBe('ДЗ 8')
  })

  it('ДЗ без срока и без сдачи в таблицу не идёт; без срока, но сдано — «сдано»', () => {
    const v = recentHomeworks([
      { title: 'Без срока', subject: 'physics', examType: 'ege', dueAt: null, firstSubmittedAt: null, status: null, score: null, gradeScale: null },
      { title: 'Сдано без срока', subject: 'physics', examType: 'ege', dueAt: null, firstSubmittedAt: ago(1), status: 'accepted', score: null, gradeScale: null },
    ], NOW)
    expect(v.map(h => [h.row.title, h.label, h.scoreText])).toEqual([['Сдано без срока', 'сдано', 'принято']])
  })
})

describe('номера, активность, предмет', () => {
  it('зоны — из базы; номер без зоны — «рост» без доли; легенда — из порогов базы', () => {
    const data = normalizeForecastResponse(rawForecast())
    const cells = zoneCells(data, 'physics')
    expect(cells).toHaveLength(20)
    expect(cells[0]).toEqual({ n: 1, zone: 'confident', share: 0.86 })
    expect(cells[2]).toEqual({ n: 3, zone: 'progress', share: 0.55 })
    expect(cells[19]).toEqual({ n: 20, zone: 'growth', share: null })
    expect(zoneLegend(data!.catalogRules)).toEqual({ growth: 'до 40 %', progress: '40–70 %', confident: 'от 70 %' })
    expect(zoneCells(data, 'algebra')).toEqual([])
  })

  it('14 клеток активности, последняя — сегодня', () => {
    const cells = activityCells(['2026-10-03', '2026-09-20', '2026-09-19'], '2026-10-03')
    expect(cells).toHaveLength(14)
    expect(cells[0].day).toBe('2026-09-20')
    expect(cells[13]).toEqual({ day: '2026-10-03', solved: true })
    expect(cells.filter(c => c.solved).length).toBe(2)
  })

  it('предмет по умолчанию — ЕГЭ математика/физика; работы режутся по предмету', () => {
    const subjects = [
      { subject: 'math', examType: 'oge', courseTitles: null },
      { subject: 'physics', examType: 'ege', courseTitles: null },
    ]
    expect(defaultSubjectKey(subjects)).toBe('physics:ege')
    expect(defaultSubjectKey([])).toBeNull()
    const rows = [{ subject: 'math', examType: 'oge', n: 1 }, { subject: 'physics', examType: 'ege', n: 2 }]
    expect(bySubject(rows, 'math:oge')).toEqual([rows[0]])
    expect(bySubject(rows, null)).toHaveLength(2)
  })
})
