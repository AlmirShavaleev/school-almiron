import { describe, it, expect, vi } from 'vitest'
import '../pdfjsCompat'

/**
 * Полифилл нужен ради одного: `PDFPageProxy.render` в pdfjs 6.1 зовёт
 * `getOrInsertComputed`, и без него страница PDF не рисуется вовсе. Проверяем
 * не «метод существует», а его договор — иначе тест ничего не ловит.
 */
type Upsert<K, V> = { getOrInsertComputed(key: K, compute: (key: K) => V): V }

describe('pdfjsCompat', () => {
  it('вычисляет значение один раз и запоминает его', () => {
    const m = new Map<string, number>() as Map<string, number> & Upsert<string, number>
    const compute = vi.fn((k: string) => k.length)

    expect(m.getOrInsertComputed('привет', compute)).toBe(6)
    expect(m.getOrInsertComputed('привет', compute)).toBe(6)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(m.get('привет')).toBe(6)
  })

  it('не пересчитывает уже лежащее значение, даже ложное', () => {
    const m = new Map<string, number>() as Map<string, number> & Upsert<string, number>
    m.set('ноль', 0)
    const compute = vi.fn(() => 42)

    // Ноль — ловушка всех наивных реализаций через `get() || compute()`.
    expect(m.getOrInsertComputed('ноль', compute)).toBe(0)
    expect(compute).not.toHaveBeenCalled()
  })

  it('передаёт ключ в вычисление', () => {
    const m = new Map<string, string>() as Map<string, string> & Upsert<string, string>
    expect(m.getOrInsertComputed('ключ', k => `${k}!`)).toBe('ключ!')
  })

  it('работает и на WeakMap', () => {
    const wm = new WeakMap<object, number>() as WeakMap<object, number> & Upsert<object, number>
    const key = {}
    expect(wm.getOrInsertComputed(key, () => 7)).toBe(7)
    expect(wm.getOrInsertComputed(key, () => 9)).toBe(7)
  })

  it('не перечисляется при обходе объекта', () => {
    expect(Object.keys(Map.prototype)).not.toContain('getOrInsertComputed')
  })
})
