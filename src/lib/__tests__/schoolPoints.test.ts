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
    expect(b[4].hint).toBe('Решите 100 задач в каталоге · пока 37')
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
