import { describe, expect, it, vi } from 'vitest'
import { AUTOCHECK_ANSWER_BATCH_SIZE, loadAutocheckAnswersBatched } from '@/lib/autocheckAnswerBatches'

describe('bounded autocheck answer requests', () => {
  it('requests 40 IDs at most, combines responses and removes duplicate IDs', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => 'task-' + i)
    const fetch = vi.fn(async (batch: string[]) => ({
      data: batch.map(task_id => ({ task_id, is_correct: true })),
      error: null,
    }))
    const result = await loadAutocheckAnswersBatched([...ids, ids[3]], fetch)
    expect(AUTOCHECK_ANSWER_BATCH_SIZE).toBe(40)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map(([batch]) => batch.length)).toEqual([40, 40, 21])
    expect(result).toHaveLength(101)
    expect(new Set(result!.map(x => x.task_id)).size).toBe(101)
  })

  it('does not silently use partial answers when a batch fails', async () => {
    const ids = Array.from({ length: 81 }, (_, i) => 'task-' + i)
    let n = 0
    const fetch = vi.fn(async (batch: string[]) => ({
      data: batch.map(task_id => ({ task_id, is_correct: false })),
      error: ++n === 2 ? { message: 'HTTP 400' } : null,
    }))
    expect(await loadAutocheckAnswersBatched(ids, fetch)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns null on thrown request and empty answers without making calls for no tasks', async () => {
    const fail = vi.fn(async () => { throw new Error('network') })
    expect(await loadAutocheckAnswersBatched(['one'], fail)).toBeNull()
    expect(await loadAutocheckAnswersBatched([], fail)).toEqual([])
    expect(fail).toHaveBeenCalledOnce()
  })
})
