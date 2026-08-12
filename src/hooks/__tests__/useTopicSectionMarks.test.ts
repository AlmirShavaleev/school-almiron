import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §122. Отметка ставится мгновенно, но при отказе базы возвращается назад И
 * отдаёт причину: экран не должен показывать состояния, которого в базе нет
 * (§94), а молчаливый откат читается как «глюк».
 */

const insertResult = { error: null as { message: string } | null }
const deleteResult = { error: null as { message: string } | null }
const insertSpy = vi.fn()
const deleteSpy = vi.fn()
let existing: Array<{ group_key: string }> = []

function selectChain() {
  const chain: any = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.then = (f: (v: unknown) => unknown) =>
    Promise.resolve({ data: existing, error: null }).then(f)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') {
        const c: any = { select: () => c, eq: () => c, maybeSingle: () => Promise.resolve({ data: { id: 'student-1' } }) }
        return c
      }
      const chain: any = selectChain()
      chain.insert = (payload: unknown) => {
        insertSpy(payload)
        return Promise.resolve({ error: insertResult.error })
      }
      chain.delete = () => {
        const del: any = {
          eq: () => del,
          then: (f: (v: unknown) => unknown) => {
            deleteSpy()
            return Promise.resolve({ error: deleteResult.error }).then(f)
          },
        }
        return del
      }
      return chain
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1' } }),
}))

import { useTopicSectionMarks } from '@/hooks/useTopicSectionMarks'

const TOPIC = 't1'

describe('useTopicSectionMarks', () => {
  beforeEach(() => {
    existing = []
    insertResult.error = null
    deleteResult.error = null
    insertSpy.mockReset()
    deleteSpy.mockReset()
  })

  it('поднимает уже поставленные отметки', async () => {
    existing = [{ group_key: 'theory' }, { group_key: 'lesson' }]
    const { result } = renderHook(() => useTopicSectionMarks(TOPIC))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect([...result.current.marks].sort()).toEqual(['lesson', 'theory'])
    expect(result.current.canMark).toBe(true)
  })

  it('отметка появляется сразу и уходит в базу от имени ученика', async () => {
    const { result } = renderHook(() => useTopicSectionMarks(TOPIC))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.toggle('theory') })

    expect(result.current.marks.has('theory')).toBe(true)
    expect(insertSpy).toHaveBeenCalledWith({ topic_id: TOPIC, student_id: 'student-1', group_key: 'theory' })
  })

  it('повторное нажатие снимает отметку', async () => {
    existing = [{ group_key: 'theory' }]
    const { result } = renderHook(() => useTopicSectionMarks(TOPIC))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.toggle('theory') })

    expect(result.current.marks.has('theory')).toBe(false)
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('отказ базы откатывает отметку и объясняет причину', async () => {
    insertResult.error = { message: 'нет прав' }
    const { result } = renderHook(() => useTopicSectionMarks(TOPIC))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.toggle('theory')).rejects.toBeTruthy()
    })

    expect(result.current.marks.has('theory')).toBe(false)
    expect(result.current.error).toContain('нет прав')
  })

  it('группу ДЗ отметить нельзя — в базу такой запрос не уходит', async () => {
    const { result } = renderHook(() => useTopicSectionMarks(TOPIC))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.toggle('homework')).rejects.toThrow(/засчитывает система/)
    })

    expect(insertSpy).not.toHaveBeenCalled()
    expect(result.current.marks.has('homework')).toBe(false)
  })
})
