import { describe, expect, it } from 'vitest'
import { activeSpec, EGE_SPECS, EXAM_DATES, maxOf, maxPrimary, part1Numbers, toTestScore } from '@/lib/egeScales'

/**
 * §255. Структура КИМ и шкалы перевода — данными (предмет + год). Тест стережёт
 * то, что ломается молча при опечатке в таблице: сумма баллов по номерам =
 * максимум первичного, таблица перевода монотонна, 0 → 0, максимум → 100.
 */
describe('шкалы ЕГЭ (egeScales)', () => {
  const specs = Object.entries(EGE_SPECS)

  it.each(specs)('%s: сумма баллов по номерам = длина шкалы − 1 = максимум первичного', (_, spec) => {
    const sum = spec.maxPoints.reduce((s, m) => s + m, 0)
    expect(maxPrimary(spec)).toBe(sum)
    expect(spec.scale.length).toBe(sum + 1)
  })

  it.each(specs)('%s: таблица монотонна, 0 → 0, максимум → 100, порог внутри шкалы', (_, spec) => {
    expect(spec.scale[0]).toBe(0)
    expect(spec.scale[spec.scale.length - 1]).toBe(100)
    for (let i = 1; i < spec.scale.length; i++) expect(spec.scale[i]).toBeGreaterThanOrEqual(spec.scale[i - 1])
    expect(spec.scale).toContain(spec.threshold)
  })

  it('профильная математика 2026: 19 заданий, 32 балла, часть 1 — №1–12 по баллу, порог 27', () => {
    const m = EGE_SPECS['math:2026']
    expect(m.maxPoints).toHaveLength(19)
    expect(maxPrimary(m)).toBe(32)
    expect(part1Numbers(m)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(part1Numbers(m).map(n => maxOf(m, n)).every(x => x === 1)).toBe(true)
    expect([13, 14, 15, 16, 17, 18, 19].map(n => maxOf(m, n))).toEqual([2, 3, 2, 2, 3, 4, 4])
    expect(m.scale[12]).toBe(70)
    expect(m.scale[30]).toBe(100)
    expect(m.threshold).toBe(27)
  })

  it('физика 2026: 26 заданий, 45 баллов, часть 1 — 28, часть 2 — 17, порог 36', () => {
    const p = EGE_SPECS['physics:2026']
    expect(p.maxPoints).toHaveLength(26)
    expect(maxPrimary(p)).toBe(45)
    const part1 = part1Numbers(p).reduce((s, n) => s + maxOf(p, n), 0)
    expect(part1).toBe(28)
    expect(maxPrimary(p) - part1).toBe(17)
    expect([5, 6, 9, 10, 14, 15, 17, 18].every(n => maxOf(p, n) === 2)).toBe(true)
    expect(p.scale[20]).toBe(58)
    expect(p.threshold).toBe(36)
  })

  it('перевод: на целых точках — таблица, между ними — линейно, за краями — прижат', () => {
    const m = EGE_SPECS['math:2026']
    expect(toTestScore(m, 9)).toBe(52)
    expect(toTestScore(m, 9.5)).toBeCloseTo(55, 6)
    expect(toTestScore(m, -1)).toBe(0)
    expect(toTestScore(m, 40)).toBe(100)
    expect(toTestScore(m, Number.NaN)).toBe(0)
  })

  it('действующая запись — по предмету; ОГЭ/прочие предметы — нет', () => {
    expect(activeSpec('math')?.year).toBe(2026)
    expect(activeSpec('physics')?.maxPoints).toHaveLength(26)
    expect(activeSpec('algebra')).toBeNull()
    expect(activeSpec('')).toBeNull()
  })

  it('ориентир даты экзамена — одной записью на год', () => {
    expect(EXAM_DATES.ege.day).toBe('2027-06-01')
    expect(EXAM_DATES.ege.hint).toContain('Точная дата появится в расписании')
    expect(EXAM_DATES.oge.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
