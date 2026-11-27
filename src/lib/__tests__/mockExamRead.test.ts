import { describe, expect, it, vi } from 'vitest'
import { readMockExamRows } from '@/lib/mockExamRead'

describe('чтение полной таблицы пробника', () => {
  it('забирает оценки после первой тысячи строк', async () => {
    const scores = Array.from({ length: 1002 }, (_, i) => i)
    const page = vi.fn(async (from: number, to: number) => ({ data: scores.slice(from, to + 1), error: null }))
    expect(await readMockExamRows(page)).toEqual({ data: scores, error: null })
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999]])
  })

  it('сообщает об ошибке второй страницы вместо возврата обрезанных данных', async () => {
    const error = { message: 'Не удалось загрузить' }
    const page = vi.fn(async (from: number) => from === 0
      ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
      : { data: null, error })
    expect(await readMockExamRows(page)).toEqual({ data: null, error })
  })
})
