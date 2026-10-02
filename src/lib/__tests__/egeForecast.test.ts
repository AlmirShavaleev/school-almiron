import { describe, expect, it } from 'vitest'
import { EGE_SPECS, toTestScore } from '@/lib/egeScales'
import { plural } from '@/lib/plural'
import {
  forecastClaims, buildForecastView, catalogGain, catalogTips, coverageNeed, forecastChange, gainText, forecastAt, missingText, normalizeEvidence, SOURCE_WEIGHT,
  normalizeForecastResponse, numberStats, parseGoalInput, PART2_TIP_MIN_P, PRIOR_PART1, PRIOR_PART2, tileHint, tileLevel, trendDates,
  type Evidence, type EvidenceSource,
} from '@/lib/egeForecast'

/**
 * §255. Модель «Примерного балла на ЕГЭ». Проверяется поведение: порог
 * покрытия, сглаживание, затухание, честность диапазона, «+N за месяц»,
 * недели, «быстрее всего добавят» и темы с несколькими номерами.
 */
const MATH = EGE_SPECS['math:2026']
const PHYS = EGE_SPECS['physics:2026']
const NOW = new Date('2026-10-02T12:00:00Z')
const DAY = 86_400_000
let seq = 0
function ev(n: number, score: number, daysAgo = 1, source: EvidenceSource = 'hw', over: Partial<Evidence> = {}): Evidence {
  seq++
  return {
    subject: 'math', n, source, score, share: 1, item: `${source}:${seq}`,
    at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), ...over,
  }
}
/** k верных задач ДЗ по номеру n. */
const many = (n: number, k: number, score = 1, daysAgo = 1) => Array.from({ length: k }, () => ev(n, score, daysAgo))
const stat = (rows: Evidence[], n: number, spec = MATH, at = NOW) => numberStats(spec, rows, at)[n - 1]

describe('прогноз: данных мало', () => {
  it('без свидетельств — прогноза нет, не хватает половины номеров части 1', () => {
    const p = forecastAt(MATH, [], NOW)
    expect(p.ready).toBe(false)
    expect(coverageNeed(MATH)).toBe(6)
    expect(p.missing).toBe(6)
    expect(missingText(p.missing, plural)).toBe('Решите ещё 6 задач из разных номеров — и мы покажем примерный балл')
    expect(missingText(1, plural)).toContain('ещё 1 задачу')
  })

  it('порог — ровно половина номеров ЧАСТИ 1: 5 номеров — нет, 6 — да; номера части 2 в покрытие не идут', () => {
    const five = [1, 2, 3, 4, 5].map(n => ev(n, 1))
    const withPart2 = [...five, ev(13, 1), ev(14, 1), ev(18, 1)]
    expect(forecastAt(MATH, withPart2, NOW)).toMatchObject({ ready: false, covered: 5, missing: 1 })
    expect(forecastAt(MATH, [...five, ev(6, 0)], NOW)).toMatchObject({ ready: true, missing: 0 })
    // физика: часть 1 — 20 номеров, нужно 10
    expect(coverageNeed(PHYS)).toBe(10)
  })

  it('много задач по ОДНОМУ номеру покрытие не закрывают — нужны разные номера', () => {
    const p = forecastAt(MATH, many(6, 30), NOW)
    expect(p.ready).toBe(false)
    expect(p.missing).toBe(5)
  })

  it('свидетельства другого предмета, будущие и старше 180 дней не считаются', () => {
    const rows = [ev(1, 1, 1, 'hw', { subject: 'physics' }), ev(2, 1, -3), ev(3, 1, 200)]
    expect(numberStats(MATH, rows, NOW).some(s => s.hasEvidence)).toBe(false)
  })
})

describe('прогноз: сглаживание и затухание', () => {
  it('без решений номер стоит на априори: часть 1 — 0,3, часть 2 — 0,1', () => {
    expect(stat([], 6).p).toBeCloseTo(PRIOR_PART1, 9)
    expect(stat([], 18).p).toBeCloseTo(PRIOR_PART2, 9)
  })

  it('одна верная задача — не 100 %, а около половины; десять верных — уверенно высоко', () => {
    const one = stat([ev(6, 1)], 6).p
    expect(one).toBeGreaterThan(0.45)
    expect(one).toBeLessThan(0.6)
    const ten = stat(many(6, 10), 6).p
    expect(ten).toBeGreaterThan(0.8)
    expect(ten).toBeLessThan(1)
  })

  it('частично = половина: «верно + частично» между «верно + неверно» и «верно + верно»', () => {
    const mixed = stat([ev(6, 1), ev(6, 0.5)], 6).p
    expect(mixed).toBeGreaterThan(stat([ev(6, 1), ev(6, 0)], 6).p)
    expect(mixed).toBeLessThan(stat([ev(6, 1), ev(6, 1)], 6).p)
  })

  it('свежие решения важнее старых (полураспад 30 дней)', () => {
    // старые ошибки и свежие успехи — выше, чем старые успехи и свежие ошибки
    const improving = [...many(6, 4, 0, 90), ...many(6, 4, 1, 2)]
    const declining = [...many(6, 4, 1, 90), ...many(6, 4, 0, 2)]
    expect(stat(improving, 6).p).toBeGreaterThan(0.6)
    expect(stat(declining, 6).p).toBeLessThan(0.4)
  })

  it('пробник весит больше ДЗ', () => {
    const rows = [ev(6, 0, 1, 'mock'), ev(6, 1, 1, 'hw')]
    expect(stat(rows, 6).p).toBeLessThan(0.5)
  })

  // §256 (решение владельца 02.10): каталог — только ПРОВЕРЕННЫЕ ответы (и
  // неверные тоже), поэтому вес как у ДЗ и без потолка. Было: 0,3 и потолок 2.
  it('каталог с проверкой весит как ДЗ и без потолка: десять верных = десять верных ДЗ', () => {
    expect(SOURCE_WEIGHT.catalog).toBe(SOURCE_WEIGHT.hw)
    const cat = stat(Array.from({ length: 10 }, () => ev(6, 1, 1, 'catalog')), 6)
    const hw = stat(many(6, 10), 6)
    expect(cat.p).toBeCloseTo(hw.p, 9)
    expect(cat.p).toBeGreaterThan(0.85)
    // 50 верных поднимают выше прежнего потолка 0,65
    expect(stat(Array.from({ length: 50 }, () => ev(6, 1, 1, 'catalog')), 6).p).toBeGreaterThan(0.95)
    expect(cat.catalogCount).toBe(10)
    expect(cat.count).toBe(10)
  })

  it('неверные ответы каталога опускают номер так же, как неверные ДЗ', () => {
    const rows = [...Array.from({ length: 6 }, () => ev(6, 0, 1, 'catalog')), ...Array.from({ length: 2 }, () => ev(6, 1, 1, 'catalog'))]
    const s = stat(rows, 6)
    expect(s.p).toBeCloseTo(stat([...many(6, 6, 0), ...many(6, 2, 1)], 6).p, 9)
    expect(s.p).toBeLessThan(PRIOR_PART1)
    expect(s.rate).toBeCloseTo(0.25, 9)
  })

  it('пробник с нумерацией другого года (число заданий шаблона ≠ 19) отбрасывается', () => {
    expect(stat([ev(6, 1, 1, 'mock', { kimTotal: 20 })], 6).hasEvidence).toBe(false)
    expect(stat([ev(6, 1, 1, 'mock', { kimTotal: 19 })], 6).hasEvidence).toBe(true)
  })
})

describe('прогноз: темы с несколькими номерами', () => {
  it('тема «№13, 14» — задача делится поровну: каждому номеру половина', () => {
    const rows = normalizeEvidence([{ subject: 'math', ns: [13, 14], source: 'hw', score: 1, at: NOW.toISOString(), item: 'hw:1' }])
    expect(rows.map(r => [r.n, r.share])).toEqual([[13, 0.5], [14, 0.5]])
    const s13 = stat(rows, 13)
    expect(s13.hasEvidence).toBe(true)
    expect(s13.p).toBeGreaterThan(PRIOR_PART2)
    expect(s13.p).toBeLessThan(stat([ev(13, 1)], 13).p)
  })

  it('половина задачи номер не покрывает, две половины — покрывают', () => {
    const half = normalizeEvidence([{ subject: 'math', ns: [1, 2], source: 'hw', score: 1, at: NOW.toISOString() }])
    expect(numberStats(MATH, half, NOW)[0].shareSum).toBeCloseTo(0.5, 9)
    const two = normalizeEvidence([1, 2].map(i => ({ subject: 'math', ns: [1, 2], source: 'hw', score: 1, at: NOW.toISOString(), item: `hw:${i}` })))
    const p = forecastAt(MATH, two, NOW)
    expect(p.covered).toBe(2)
  })

  it('тема шире трёх номеров («Повторение №1–12») пропускается — не закрывает покрытие', () => {
    const rows = normalizeEvidence(Array.from({ length: 12 }, (_, i) => ({
      subject: 'math', ns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], source: 'hw', score: 1, at: NOW.toISOString(), item: `hw:${i}`,
    })))
    expect(rows).toHaveLength(144)
    const p = forecastAt(MATH, rows, NOW)
    expect(p.covered).toBe(0)
    expect(p.ready).toBe(false)
  })

  it('разбор строк базы: мусор пропускается, дубли номеров схлопываются', () => {
    const rows = normalizeEvidence([
      null, { source: 'x' }, { subject: 'math', ns: [], source: 'hw', score: 1, at: 'x' },
      { subject: 'math', ns: [6, 6], source: 'hw', score: '0.5', at: NOW.toISOString() },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ n: 6, share: 1, score: 0.5 })
  })
})

/** Ученик, у которого покрыта вся первая часть: n номеров по k задач с долей верного rate. */
function solid(k = 4, rate = 0.75, daysAgo = 3): Evidence[] {
  const out: Evidence[] = []
  for (let n = 1; n <= 12; n++) {
    for (let i = 0; i < k; i++) out.push(ev(n, i < Math.round(k * rate) ? 1 : 0, daysAgo))
  }
  return out
}

describe('прогноз: балл и диапазон', () => {
  it('ожидаемый первичный = Σ p_n × max_n, тестовый — по шкале', () => {
    const rows = solid()
    const p = forecastAt(MATH, rows, NOW)
    const primary = numberStats(MATH, rows, NOW).reduce((s, x) => s + x.p * x.max, 0)
    expect(p.primary).toBeCloseTo(primary, 9)
    expect(p.score).toBeCloseTo(toTestScore(MATH, primary), 9)
    expect(p.ready).toBe(true)
  })

  it('диапазон содержит балл и честно сужается, когда решений больше', () => {
    const few = forecastAt(MATH, solid(4), NOW)
    const lots = forecastAt(MATH, solid(16), NOW)
    expect(few.low).toBeLessThanOrEqual(few.score)
    expect(few.high).toBeGreaterThanOrEqual(few.score)
    expect(lots.high - lots.low).toBeLessThan(few.high - few.low)
  })

  it('диапазон в границах шкалы 0..100', () => {
    const all = []
    for (let n = 1; n <= 19; n++) all.push(...many(n, 30, 1))
    const p = forecastAt(MATH, all, NOW)
    expect(p.high).toBeLessThanOrEqual(100)
    expect(p.low).toBeGreaterThan(p.score - 30)
  })

  it('вид карточки: округлённые балл и диапазон, «от» ≤ балл ≤ «до»', () => {
    const v = buildForecastView(MATH, solid(), NOW)
    expect(Number.isInteger(v.score)).toBe(true)
    expect(v.low).toBeLessThanOrEqual(v.score)
    expect(v.high).toBeGreaterThanOrEqual(v.score)
  })
})

describe('прогноз: «+N за месяц» и 8 недель', () => {
  it('«+N за месяц» — тот же расчёт на дату 30 дней назад', () => {
    // 40 дней назад — средне; за последние 2 недели — много верных
    const rows = [...solid(4, 0.5, 40), ...solid(4, 1, 5)]
    const v = buildForecastView(MATH, rows, NOW)
    const ago = forecastAt(MATH, rows, new Date(NOW.getTime() - 30 * DAY))
    expect(ago.ready).toBe(true)
    expect(v.monthDelta).toBe(v.score - Math.round(ago.score))
    expect(v.monthDelta!).toBeGreaterThan(0)
  })

  it('месяц назад данных не хватало — «+N за месяц» не показываем', () => {
    expect(buildForecastView(MATH, solid(4, 1, 5), NOW).monthDelta).toBeNull()
  })

  it('недели: 8 точек — концы 7 прошедших недель (вс) и сегодня; до покрытия — пусто', () => {
    const dates = trendDates(NOW) // пятница 2 октября
    expect(dates).toHaveLength(8)
    expect(dates[6].day).toBe('2026-09-27')
    expect(dates[0].day).toBe('2026-08-16')
    expect(dates[7]).toMatchObject({ day: '2026-10-02', current: true })
    const v = buildForecastView(MATH, solid(4, 1, 20), NOW)
    expect(v.trend.map(t => t.score == null)).toEqual([true, true, true, true, false, false, false, false])
    expect(v.trend[7].score).toBe(v.score)
  })

  it('неделя считается тем же кодом: точка недели = forecastAt на конец её воскресенья (Москва)', () => {
    const rows = [...solid(4, 0.5, 40), ...solid(4, 1, 5)]
    const v = buildForecastView(MATH, rows, NOW)
    const sunday = forecastAt(MATH, rows, new Date('2026-09-27T20:59:59.999Z'))
    expect(v.trend[6].score).toBe(Math.round(sunday.score))
  })

  it('§257: что сообщить базе для «Роста прогноза» — текущий балл и первая неделя с баллом; без балла — ничего', () => {
    const rows = [...solid(4, 0.5, 40), ...solid(4, 1, 5)]
    const data = { now: NOW, subjects: [{ subject: 'math' as const, goal: null, teacherGoal: null }], titles: {}, sections: {}, zones: {}, catalogRules: null, evidence: rows }
    const view = buildForecastView(MATH, rows, NOW)
    const claims = forecastClaims(data)
    expect(claims).toEqual([{ subject: 'math', first: view.trend.find(t => t.score != null)!.score, current: view.score }])
    // балл рос: первый показ ниже текущего
    expect(claims[0].first).toBeLessThan(claims[0].current)
    expect(forecastClaims({ ...data, evidence: [] })).toEqual([])
    expect(forecastClaims(null)).toEqual([])
  })
})

describe('прогноз: «быстрее всего добавят баллы» и плитки', () => {
  it('три номера с наибольшим приростом, если поднять p до 0,8; номер без решений — «?»', () => {
    const rows: Evidence[] = []
    for (let n = 1; n <= 12; n++) {
      if (n === 10) continue // №10 ещё не решали
      const rate = n === 6 ? 0.2 : n === 9 ? 0.4 : 0.9
      for (let i = 0; i < 10; i++) rows.push(ev(n, i < rate * 10 ? 1 : 0))
    }
    const v = buildForecastView(MATH, rows, NOW)
    expect(v.tips).toHaveLength(3)
    expect(v.tips.map(t => t.n)).toEqual(expect.arrayContaining([6, 9, 10]))
    expect(v.tips[0].n).toBe(6)
    expect(v.tips.find(t => t.n === 10)!.gain).toBeNull()
    expect(v.tips.find(t => t.n === 6)!.gain!).toBeGreaterThanOrEqual(1)
    // прирост посчитан шкалой: тот же расчёт, что и балл
    const base = toTestScore(MATH, v.current.primary)
    const s6 = v.current.numbers[5]
    expect(v.tips[0].rawGain).toBeCloseTo(toTestScore(MATH, v.current.primary + (0.8 - s6.p)) - base, 9)
  })

  it('вторая часть — только номера, которые уже решаются хоть иногда (p ≥ 0,35)', () => {
    // часть 1 решена почти вся; №14 (3 балла) — почти не решает, №13 — чаще верно
    const rows = [...solid(10, 0.9), ...many(14, 4, 0), ev(14, 1), ...many(13, 4, 1), ...many(13, 2, 0)]
    const v = buildForecastView(MATH, rows, NOW)
    expect(v.current.numbers[13].p).toBeLessThan(PART2_TIP_MIN_P)
    expect(v.current.numbers[12].p).toBeGreaterThanOrEqual(PART2_TIP_MIN_P)
    const ns = v.tips.map(t => t.n)
    expect(ns).not.toContain(14)
    expect(ns).not.toContain(18) // не решали вовсе
    expect(ns[0]).toBe(13)
  })

  it('плитка: 4 ступени по p и штриховка «пока не решали»; подсказка «верно N % решений (k задач)»', () => {
    const rows = [...many(6, 7, 0), ...many(6, 3, 1), ev(7, 1, 1, 'catalog')]
    const s6 = stat(rows, 6), s7 = stat(rows, 7), s8 = stat(rows, 8)
    expect(tileLevel(s8)).toBe(0)
    expect(tileLevel(s6)).toBe(1)
    expect(tileLevel(stat(many(5, 20), 5))).toBe(4)
    expect(tileHint(s6, plural)).toBe('№6: верно 30 % решений (10 задач)')
    expect(tileHint(s7, plural)).toBe('№7: верно 100 % решений (1 задача, из них 1 в каталоге)')
    expect(tileHint(s8, plural)).toBe('№8: пока не решали — в прогнозе считаем осторожно')
  })

  it('«Считаем по последним решениям»: задачи ДЗ, каталог, пробники — без двойного счёта', () => {
    const rows = normalizeEvidence([
      { subject: 'math', ns: [13, 14], source: 'hw', score: 1, at: NOW.toISOString(), item: 'hw:a:1' },
      { subject: 'math', ns: [1], source: 'mock', score: 1, at: NOW.toISOString(), item: 'mock:m1', kim_total: 19 },
      { subject: 'math', ns: [2], source: 'mock', score: 0, at: NOW.toISOString(), item: 'mock:m1', kim_total: 19 },
      { subject: 'math', ns: [6], source: 'catalog', score: 1, at: NOW.toISOString(), item: 'catalog:t1' },
    ])
    expect(buildForecastView(MATH, rows, NOW).sources).toEqual({ hw: 1, test: 0, mock: 1, catalog: 1 })
  })
})

describe('ответ базы и цель', () => {
  it('ответ: «сейчас» сервера, предметы по порядку, цель и цель учителя, названия номеров', () => {
    const r = normalizeForecastResponse({
      now: '2026-10-02T09:00:00Z',
      subjects: [{ subject: 'physics', goal: 70, teacher_goal: null }, { subject: 'math', goal: null, teacher_goal: 75 }, { subject: 'algebra' }],
      titles: [{ subject: 'math', n: 6, title: 'Простейшие уравнения' }],
      evidence: [{ subject: 'math', ns: [6], source: 'hw', score: 1, at: '2026-10-01T10:00:00Z' }],
    })!
    expect(r.now.toISOString()).toBe('2026-10-02T09:00:00.000Z')
    expect(r.subjects).toEqual([
      { subject: 'math', goal: null, teacherGoal: 75 },
      { subject: 'physics', goal: 70, teacherGoal: null },
    ])
    expect(r.titles['math:6']).toBe('Простейшие уравнения')
    expect(r.evidence).toHaveLength(1)
    expect(normalizeForecastResponse(null)).toBeNull()
  })

  it('ввод цели: целое 1..100; пусто — снять; остальное — ошибка', () => {
    expect(parseGoalInput('80')).toEqual({ ok: true, goal: 80 })
    expect(parseGoalInput(' 1 ')).toEqual({ ok: true, goal: 1 })
    expect(parseGoalInput('100')).toEqual({ ok: true, goal: 100 })
    expect(parseGoalInput('')).toEqual({ ok: true, goal: null })
    for (const bad of ['0', '101', '7.5', '-3', 'abc', '1000']) expect(parseGoalInput(bad).ok).toBe(false)
  })
})

describe('§256: «Решите в каталоге — и балл вырастет»', () => {
  const RULES = {
    window_days: 60, low: 0.4, high: 0.7, daily_task: 10, weekly_goal: 40,
    zones: [
      { key: 'growth', per_task: 5, milestones: [{ at: 10, bonus: 30 }, { at: 20, bonus: 50 }, { at: 30, bonus: 80 }] },
      { key: 'progress', per_task: 3, milestones: [{ at: 10, bonus: 20 }, { at: 20, bonus: 30 }, { at: 30, bonus: 40 }] },
      { key: 'confident', per_task: 1, milestones: [{ at: 10, bonus: 5 }, { at: 20, bonus: 5 }, { at: 30, bonus: 5 }] },
    ],
  }
  /** Номера 1–12 решаются на 75 %, №6 — на 25 %, №2 — почти всегда. */
  function rows(): Evidence[] {
    const out: Evidence[] = []
    for (let n = 1; n <= 12; n++) {
      const rate = n === 6 ? 0.25 : n === 2 ? 1 : 0.75
      for (let i = 0; i < 8; i++) out.push(ev(n, i < Math.round(8 * rate) ? 1 : 0, 3))
    }
    return out
  }
  function response(evidence: Evidence[]) {
    return normalizeForecastResponse({
      now: NOW.toISOString(),
      subjects: [{ subject: 'math' }],
      titles: Array.from({ length: 12 }, (_, i) => ({ subject: 'math', n: i + 1, title: `Номер ${i + 1}`, section_id: `sec-${i + 1}` })),
      numbers: [
        { subject: 'math', n: 6, zone: 'growth', share: 0.25, solved: 3 },
        { subject: 'math', n: 2, zone: 'confident', share: 1, solved: 12 },
        { subject: 'math', n: 9, zone: 'progress', share: 0.55, solved: 0 },
      ],
      catalog_rules: RULES,
      evidence: [],
    })!
  }

  it('«≈ +N за 10 верных» — та же модель: 10 верных задач каталога по номеру; слабому номеру — больше', () => {
    const r = rows()
    const weak = catalogGain(MATH, r, 6, NOW)
    const strong = catalogGain(MATH, r, 2, NOW)
    const sim = Array.from({ length: 10 }, (_, i) => ev(6, 1, 0, 'catalog', { item: `x${i}`, at: new Date(NOW.getTime() - 1000).toISOString() }))
    expect(weak).toBeCloseTo(forecastAt(MATH, [...r, ...sim], NOW).score - forecastAt(MATH, r, NOW).score, 9)
    expect(weak).toBeGreaterThan(strong)
    expect(strong).toBeLessThan(1.5)
    expect(gainText(weak)).toMatch(/^≈ \+\d+ к прогнозу$/)
    expect(gainText(0.2)).toBe('≈ +1 к прогнозу')
  })

  it('список: «уверенно» — отдельно, остальные по приросту; «верно k из 10» — до следующей вехи', () => {
    const data = { ...response([]), evidence: rows() }
    const point = forecastAt(MATH, data.evidence, NOW)
    const { tips, confident } = catalogTips(MATH, data, point)
    expect(tips).toHaveLength(3)
    expect(tips[0]).toMatchObject({ n: 6, zone: 'growth', solved: 3, next: 10, sectionId: 'sec-6', title: 'Номер 6' })
    expect(tips.every(t => t.zone !== 'confident')).toBe(true)
    expect(tips[0].gain!).toBeGreaterThan(tips[1].gain!)
    expect(confident.map(t => t.n)).toEqual([2])
    expect(confident[0].next).toBe(20)
  })

  it('пока балла нет — сначала номера без решений (откроют прогноз), прироста не показываем', () => {
    const data = { ...response([]), evidence: [ev(1, 1), ev(3, 1)] }
    const point = forecastAt(MATH, data.evidence, NOW)
    expect(point.ready).toBe(false)
    const { tips } = catalogTips(MATH, data, point)
    expect(tips.map(t => t.n)).toEqual([4, 5, 6])
    expect(tips.every(t => t.gain == null)).toBe(true)
  })

  it('номер без раздела каталога в список не попадает', () => {
    const data = { ...response([]), evidence: rows(), sections: { 'math:6': 'sec-6' } }
    const { tips } = catalogTips(MATH, data, forecastAt(MATH, data.evidence, NOW))
    expect(tips.map(t => t.n)).toEqual([6])
  })

  it('изменение прогноза до/после проверки — модель на свидетельствах базы', () => {
    const before = { ...response([]), evidence: rows() }
    const after = { ...before, evidence: [...rows(), ev(6, 1, 0, 'catalog')] }
    const c = forecastChange(before, after, 'math')!
    expect(c.ready).toBe(true)
    expect(c.delta).toBeGreaterThan(0)
    expect(c.delta).toBeCloseTo(forecastAt(MATH, after.evidence, NOW).score - forecastAt(MATH, before.evidence, NOW).score, 9)
    expect(forecastChange(before, after, 'oge-math')).toBeNull()
    expect(forecastChange(null, after, 'math')).toBeNull()
  })

  it('ответ базы: разделы, зоны и правила номеров', () => {
    const r = response([])
    expect(r.sections['math:6']).toBe('sec-6')
    expect(r.zones['math:6']).toEqual({ zone: 'growth', share: 0.25, solved: 3 })
    expect(r.catalogRules?.zones[0].perTask).toBe(5)
  })
})
