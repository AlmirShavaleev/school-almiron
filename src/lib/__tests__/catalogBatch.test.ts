import { describe, expect, it } from 'vitest'
import { mapCatalogBatches } from '@/lib/catalogBatch'

describe('mapCatalogBatches', () => {
  it('сохраняет порядок результатов при параллельной загрузке', async () => {
    let active = 0
    let peak = 0
    const calls: number[][] = []

    const result = await mapCatalogBatches([1, 2, 3, 4, 5, 6, 7], 2, 3, async batch => {
      calls.push(batch)
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return batch.map(n => String(n))
    })

    expect(peak).toBe(3)
    expect(calls).toEqual([[1, 2], [3, 4], [5, 6], [7]])
    expect(result).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('не делает запросов для пустого списка', async () => {
    let calls = 0
    const result = await mapCatalogBatches([], 50, 3, async () => {
      calls++
      return ['unexpected']
    })
    expect(result).toEqual([])
    expect(calls).toBe(0)
  })

  it('не скрывает ошибки запроса', async () => {
    await expect(mapCatalogBatches([1], 50, 3, async () => {
      throw new Error('network error')
    })).rejects.toThrow('network error')
  })

  it('отклоняет некорректные параметры', async () => {
    await expect(mapCatalogBatches([1], 0, 3, async items => items)).rejects.toThrow('batchSize')
    await expect(mapCatalogBatches([1], 50, 0, async items => items)).rejects.toThrow('concurrency')
  })
})
