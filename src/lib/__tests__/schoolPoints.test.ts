import { describe, expect, it } from 'vitest'
import { buildBadges, feedText, FORECAST_BADGE_DELTA, levelProgress, normalizeSchoolPoints, rulesText } from '@/lib/schoolPoints'

/**
 * §255. «Баллы школы»: разбор ответа базы, лента, уровень, значки. Правила и
 * пороги — в базе (одна таблица констант student_school_points); здесь
 * проверяется, что клиент берёт их из ответа и не держит своих чисел.
 */
const RAW = {
  total: 340,
  level: { n: 4, name: 'Упорство', from: 300, next: 450, next_name: 'Система' },
  levels: [0, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500],
  rules: { hw_ontime: 10, hw_late: 4, grade5: 10, grade4: 6, accepted: 6, catalog: 2, mock_point: 1, streak_day: 3 },
  feed: [
    { kind: 'hw_ontime', at: '2026-10-02T10:00:00Z', points: 10, title: 'Динамика. Теория', n: null },
    { kind: 'streak', at: '2026-10-02T08:00:00Z', points: 3, title: null, n: 5 },
    { kind: 'catalog', at: '2026-10-01T18:00:00Z', points: 6, title: null, n: 3 },
    { kind: 'hw_grade', at: '2026-10-01T12:00:00Z', points: 6, title: 'Производные', n: 4 },
    { kind: 'mock', at: '2026-09-28T09:00:00Z', points: 14, title: 'Пробник сентября', n: 14 },
    { kind: 'hw_late', at: '2026-09-27T09:00:00Z', points: 4, title: 'Импульс', n: null },
    { kind: 'unknown', at: '2026-09-27T09:00:00Z', points: 4 },
    { kind: 'hw_grade', at: '2026-09-26T09:00:00Z', points: 0, title: 'Тройка', n: 3 },
  ],
  badges: [
    { key: 'streak7', have: 12, need: 7 },
    { key: 'ontime10', have: 4, need: 10 },
    { key: 'mock1', have: 0, need: 1 },
    { key: 'catalog100', have: 37, need: 100 },
  ],
}

describe('баллы школы', () => {
  it('разбор: сумма, уровень, правила; лента без нулевых и незнакомых строк', () => {
    const p = normalizeSchoolPoints(RAW)!
    expect(p.total).toBe(340)
    expect(p.level).toEqual({ n: 4, name: 'Упорство', from: 300, next: 450, nextName: 'Система' })
    expect(p.feed.map(f => f.kind)).toEqual(['hw_ontime', 'streak', 'catalog', 'hw_grade', 'mock', 'hw_late'])
    expect(normalizeSchoolPoints(null)).toBeNull()
    expect(normalizeSchoolPoints({})).toBeNull()
  })

  it('лента «за что»: текст по виду начисления', () => {
    const p = normalizeSchoolPoints(RAW)!
    expect(p.feed.map(feedText)).toEqual([
      'ДЗ «Динамика. Теория» сдано вовремя',
      '5 дней подряд',
      '3 задачи из каталога решены',
      'ДЗ «Производные» принято — 4',
      '«Пробник сентября» — 14 первичных баллов',
      'ДЗ «Импульс» сдано после срока',
    ])
    expect(feedText({ kind: 'catalog', at: '', points: 2, title: null, n: 1 })).toBe('1 задача из каталога решена')
    expect(feedText({ kind: 'hw_grade', at: '', points: 6, title: 'Оптика', n: null })).toBe('ДЗ «Оптика» принято')
    expect(feedText({ kind: 'mock', at: '', points: 3, title: 'Сентябрь', n: 3 })).toBe('Пробник «Сентябрь» — 3 первичных балла')
    expect(feedText({ kind: 'mock', at: '', points: 1, title: null, n: 1 })).toBe('Пробник — 1 первичный балл')
  })

  it('уровень: доля пути и «до 5-го уровня — 110 баллов»; на последнем — «высший уровень»', () => {
    const p = normalizeSchoolPoints(RAW)!
    expect(levelProgress(p)).toEqual({ ratio: 40 / 150, text: 'до 5-го уровня — 110 баллов' })
    expect(levelProgress({ total: 1700, level: { n: 10, name: 'Вершина', from: 1500, next: null, nextName: null } }))
      .toEqual({ ratio: 1, text: 'высший уровень' })
    expect(levelProgress({ total: 99, level: { n: 1, name: 'Старт', from: 0, next: 100, nextName: 'Разгон' } }).text)
      .toBe('до 2-го уровня — 1 балл')
  })

  it('значки: получен / ещё нет с подсказкой «как получить»; пороги — из ответа базы', () => {
    const p = normalizeSchoolPoints(RAW)!
    const b = buildBadges(p, 3)
    expect(b.map(x => [x.key, x.got])).toEqual([
      ['streak7', true], ['ontime10', false], ['forecast5', false], ['mock1', false], ['catalog100', false],
    ])
    expect(b[1].hint).toBe('Сдайте 10 ДЗ до срока · пока 4')
    expect(b[2].hint).toBe('Поднимите примерный балл на 5 за 30 дней · сейчас +3')
    expect(b[4].hint).toBe('Решите 100 задач в каталоге с проверкой ответа · пока 37')
    // владелец поменял порог в базе — значок меняется без правки клиента
    const changed = buildBadges({ badges: [{ key: 'ontime10', have: 4, need: 3 }] }, null)
    expect(changed[1]).toMatchObject({ title: '3 ДЗ вовремя', got: true })
  })

  it('«Прогноз +5» считает клиент: +5 и больше за 30 дней — получен; нет прогноза — нет', () => {
    const p = normalizeSchoolPoints(RAW)!
    expect(buildBadges(p, FORECAST_BADGE_DELTA)[2].got).toBe(true)
    expect(buildBadges(p, 4)[2].got).toBe(false)
    expect(buildBadges(p, null)[2]).toMatchObject({ got: false, hint: 'Поднимите примерный балл на 5 за 30 дней' })
  })

  it('«за что начисляются» — из правил ответа', () => {
    const p = normalizeSchoolPoints({ ...RAW, rules: { ...RAW.rules, hw_ontime: 12 } })!
    expect(rulesText(p.rules)[0]).toBe('ДЗ сдано вовремя +12, после срока +4')
  })
})

describe('§256: каталог с проверкой, вехи, задача дня, цель недели', () => {
  const CAT_RULES = {
    window_days: 60, low: 0.4, high: 0.7, daily_task: 10, weekly_goal: 40,
    zones: [
      { key: 'growth', per_task: 5, milestones: [{ at: 10, bonus: 30 }, { at: 20, bonus: 50 }, { at: 30, bonus: 80 }] },
      { key: 'progress', per_task: 3, milestones: [{ at: 10, bonus: 20 }, { at: 20, bonus: 30 }, { at: 30, bonus: 40 }] },
      { key: 'confident', per_task: 1, milestones: [{ at: 10, bonus: 5 }, { at: 20, bonus: 5 }, { at: 30, bonus: 5 }] },
    ],
  }
  const raw = {
    ...RAW,
    rules: { hw_ontime: 10, hw_late: 4, grade5: 10, grade4: 6, accepted: 6, variant: 2, mock_point: 1, streak_day: 3 },
    catalog_rules: CAT_RULES,
    feed: [
      { kind: 'weekly', at: '2026-10-02T12:00:00Z', points: 40, title: null, n: 10 },
      { kind: 'daily', at: '2026-10-02T11:00:00Z', points: 10, title: null, n: 6 },
      { kind: 'catalog_milestone', at: '2026-10-02T10:00:00Z', points: 30, title: null, n: 10 },
      { kind: 'catalog', at: '2026-10-02T10:00:00Z', points: 13, title: null, n: 3 },
      { kind: 'variant', at: '2026-10-01T10:00:00Z', points: 4, title: null, n: 2 },
    ],
  }

  it('новые строки ленты', () => {
    const p = normalizeSchoolPoints(raw)!
    expect(p.feed.map(feedText)).toEqual([
      'Цель недели выполнена',
      'Задача дня решена (№6)',
      '10 задач каталога по номеру — веха',
      '3 задачи из каталога решены',
      '2 задачи к уроку и в вариантах решены',
    ])
  })

  it('«за что начисляются» — каталог по зоне, задача дня и цель недели из правил базы; самоотметок нет', () => {
    const p = normalizeSchoolPoints(raw)!
    const t = rulesText(p.rules, p.catalogRules)
    expect(t).toContain('Задача каталога с проверкой ответа +5 / +3 / +1 — больше за номер, который пока не получается; бонусы за 10/20/30 верных')
    expect(t).toContain('Задача дня +10, цель недели +40')
    expect(t).toContain('Задача к уроку или в варианте +2')
    expect(t.join(' ')).not.toMatch(/Задача каталога \+2/)
  })

  it('старая база (rules.catalog, без catalog_rules) — не падает: вариант из catalog, строки каталога по зоне нет', () => {
    const p = normalizeSchoolPoints(RAW)!
    expect(p.rules.variant).toBe(2)
    expect(p.catalogRules).toBeNull()
    expect(rulesText(p.rules, p.catalogRules).some(x => x.startsWith('Задача каталога с проверкой'))).toBe(false)
  })

  it('значок «Неделя без пропусков» — по дням с решением', () => {
    const b = buildBadges({ badges: [{ key: 'streak7', have: 3, need: 7 }] }, null)
    expect(b[0].hint).toBe('Решайте задачи 7 дней подряд · рекорд пока 3')
  })
})
