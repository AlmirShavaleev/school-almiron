import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateSharedAutocheckLoads, shareAutocheckLoad } from '@/lib/sharedAutocheckLoad'

beforeEach(() => {
  invalidateSharedAutocheckLoads()
  vi.useFakeTimers()
})
afterEach(() => {
  invalidateSharedAutocheckLoads()
  vi.useRealTimers()
})

describe('shared student autocheck requests', () => {
  it('joins simultaneous calls from the page and menu without duplicate traffic', async () => {
    let complete!: (value: number[]) => void
    const fetcher = vi.fn(() => new Promise<number[]>(resolve => { complete = resolve }))
    const first = shareAutocheckLoad('student-a|topics-1', fetcher)
    const second = shareAutocheckLoad('student-a|topics-1', fetcher)
    expect(first).toBe(second)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    complete([1, 2, 3])
    expect(await Promise.all([first, second])).toEqual([[1, 2, 3], [1, 2, 3]])
  })

  it('isolates different students and visible topic sets', async () => {
    const fetcher = vi.fn(async () => [1])
    await Promise.all([
      shareAutocheckLoad('student-a|topics-1', fetcher),
      shareAutocheckLoad('student-b|topics-1', fetcher),
      shareAutocheckLoad('student-a|topics-2', fetcher),
    ])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('expires completed data promptly and supports invalidation', async () => {
    const fetcher = vi.fn(async () => 10)
    await shareAutocheckLoad('student-a|topics-1', fetcher)
    await shareAutocheckLoad('student-a|topics-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await shareAutocheckLoad('student-a|topics-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    invalidateSharedAutocheckLoads('student-a|')
    await shareAutocheckLoad('student-a|topics-1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never caches rejected requests', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(2)
    await expect(shareAutocheckLoad('student-a|topics-1', fetcher)).rejects.toThrow('network')
    expect(await shareAutocheckLoad('student-a|topics-1', fetcher)).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
