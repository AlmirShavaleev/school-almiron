import { describe, expect, it } from 'vitest'
import {
  distributeVariants, isPdfFile, missingConditions, variantCounts, variantFilePath, variantName, variantReadiness,
} from '@/lib/mockExamVariants'
import { assignProblems, readiness, studentTimeline } from '@/lib/mockExamV3'

/** §229. Варианты: раздача, пути, чек-лист. */

const S = (id: string, name: string) => ({ id, name })
// Нарочно не по алфавиту: раздача идёт по списку в алфавитном порядке.
const ROSTER = [S('g', 'Гарипов Тимур'), S('a', 'Абрамова Дарья'), S('b', 'Белов Артём'), S('e', 'Ёлкина Мария'), S('i1', 'Иванов Иван'), S('i2', 'Иванов Кирилл'), S('k', 'Каримова Алсу')]

function seq(values: number[]) { let i = 0; return () => values[i++ % values.length] }

describe('раздача вариантов', () => {
  it('по очереди: по алфавиту, по кругу — соседи по списку получают разные варианты', () => {
    const a = distributeVariants(ROSTER, [1, 2, 3], 'order')
    // Абрамова, Белов, Гарипов, Ёлкина, Иванов И., Иванов К., Каримова
    expect(['a', 'b', 'g', 'e', 'i1', 'i2', 'k'].map(id => a[id])).toEqual([1, 2, 3, 1, 2, 3, 1])
    expect(variantCounts(a, [1, 2, 3])).toEqual({ 1: 3, 2: 2, 3: 2 })
  })

  it('кто уже открыл пробник (бланк/фото) — остаётся на своём варианте', () => {
    const a = distributeVariants(ROSTER, [1, 2, 3], 'order', { locked: { b: 3 } })
    expect(a.b).toBe(3)
    expect(a.a).toBe(1)
    expect(a.g).toBe(3)
  })

  it('случайно — поровну (разница не больше одного) и повторяемо при том же «случае»', () => {
    const rng = () => seq([0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.6])
    const a = distributeVariants(ROSTER, [1, 2, 3], 'random', { rng: rng() })
    const b = distributeVariants(ROSTER, [1, 2, 3], 'random', { rng: rng() })
    expect(a).toEqual(b)
    const c = Object.values(variantCounts(a, [1, 2, 3]))
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1)
    expect(Object.keys(a)).toHaveLength(7)
  })

  it('случайно с закреплённым: закреплённый считается в занятости', () => {
    const a = distributeVariants(ROSTER.slice(0, 3), [1, 2, 3], 'random', { locked: { a: 1 }, rng: seq([0.5]) })
    expect(a.a).toBe(1)
    expect(new Set(Object.values(a)).size).toBe(3)
  })

  it('вручную — как стоит сейчас; кому не стоит ничего или вариант исчез — по очереди', () => {
    const a = distributeVariants(ROSTER, [1, 2], 'manual', { current: { a: 2, b: 2, g: 5 } })
    expect(a.a).toBe(2)
    expect(a.b).toBe(2)
    expect(a.g).toBe(1) // варианта 5 нет — по очереди (третий в списке → 1)
  })

  it('вариантов нет — никого не раздаём', () => {
    expect(distributeVariants(ROSTER, [], 'order')).toEqual({})
  })
})

describe('пути и имена', () => {
  it('файл варианта — в папке v<номер>/<вид>, имя безопасное', () => {
    expect(variantFilePath('ex1', 2, 'criteria', 'Критерии вар 2.pdf', 42)).toMatch(/^ex1\/v2\/criteria\/42_.+\.pdf$/)
    expect(variantFilePath('ex1', 3, 'condition', 'a.pdf', 1)).toBe('ex1/v3/condition/1_a.pdf')
  })
  it('имя варианта: подпись, если задана', () => {
    expect(variantName({ position: 2 })).toBe('Вариант 2')
    expect(variantName({ position: 2, label: ' Резерв ' })).toBe('Резерв')
  })
  it('PDF — по типу или по имени', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'x' })).toBe(true)
    expect(isPdfFile({ mime_type: null, file_name: 'скан.PDF' })).toBe(true)
    expect(isPdfFile({ mime_type: 'image/webp', file_name: 'p.webp' })).toBe(false)
  })
})

describe('чек-лист и «Назначить»', () => {
  const v = (position: number, over: Partial<{ hasCondition: boolean; hasSolution: boolean; hasCriteria: boolean; keyFilled: number }> = {}) => ({
    position, hasCondition: true, hasSolution: false, hasCriteria: false, keyFilled: 12, keyTotal: 12, ...over,
  })

  it('несколько вариантов: у варианта без условия — своя строка «не назначить»; решения и критерии — «можно позже»', () => {
    const lines = variantReadiness([v(1, { hasCriteria: true }), v(2, { hasSolution: true, keyFilled: 12 }), v(3, { hasCondition: false, keyFilled: 0 })])
    expect(lines.map(l => [l.state, l.text])).toEqual([
      ['todo', 'Вариант 3: нет условия — не назначить'],
      ['later', 'Ключи: 1 — 12 из 12, 2 — 12 из 12, 3 — 0 из 12 — пустые проверите вручную'],
      ['later', 'Решения: 1 из 3 — можно позже'],
      ['later', 'Критерии: 1 из 3 — можно позже'],
    ])
    expect(missingConditions([v(1), v(2, { hasCondition: false }), v(3, { hasCondition: false })])).toEqual([2, 3])
  })

  it('один вариант — как в §228 плюс критерии «можно позже»', () => {
    const lines = readiness({ groups: 1, startsIso: '2027-01-01T07:00:00Z', hasCondition: true, hasSolution: false, keyFilled: 12, keyTotal: 12, variants: [v(1)] })
    expect(lines.map(l => l.text)).toEqual(['Группа выбрана', 'Время начала задано', 'Условие загружено', 'Ключ: 12 из 12', 'Решение — можно добавить позже', 'Критерии — можно добавить позже'])
  })

  it('«Назначить» с вариантом без условия — нельзя; черновиком — можно', () => {
    const base = { title: 'П', templateId: 't', groups: 1, startsIso: '2027-01-01T07:00:00Z', durationOk: true }
    expect(assignProblems({ ...base, draft: false, missingCondition: [3] })).toEqual(['Вариант 3: нет условия — загрузите его или уберите вариант'])
    expect(assignProblems({ ...base, draft: true, missingCondition: [3] })).toEqual([])
  })

  it('таймлайн: при нескольких вариантах — «у каждого свой»', () => {
    const t = studentTimeline('2099-01-01T07:00:00Z', 235, 15, Date.parse('2098-12-01T00:00:00Z'), 3)
    expect(t.find(i => i.key === 'start')?.text).toContain('у каждого — свой из 3 вариантов')
  })
})
