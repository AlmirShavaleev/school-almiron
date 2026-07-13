import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVariantAttempt } from '@/hooks/useVariantAttempt'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => {
  const answersQuery = {
    select: vi.fn(() => answersQuery),
    eq: vi.fn(async () => ({ data: [], error: null })),
  }

  return {
    supabase: {
      rpc: rpcMock,
      from: vi.fn((table: string) => {
        if (table === 'test_variant_answers' || table === 'test_variant_answer_attachments') {
          return answersQuery
        }
        return {
          select: vi.fn(() => answersQuery),
          eq: vi.fn(async () => ({ data: [], error: null })),
          in: vi.fn(() => answersQuery),
          order: vi.fn(() => answersQuery),
          range: vi.fn(async () => ({ data: [], error: null })),
        }
      }),
    },
  }
})

describe('useVariantAttempt submit flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rpcMock.mockReset()
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'save_variant_answer') return { data: null, error: null }
      if (name === 'submit_variant') {
        return {
          data: {
            status: 'submitted',
            answered_count: 1,
            correct_count: 1,
            score: 1,
            max_score: 1,
            percentage: 100,
            grading_status: 'auto_graded',
            manual_review_count: 0,
            submitted_at: '2026-07-13T10:00:00Z',
            completed_at: '2026-07-13T10:00:00Z',
          },
          error: null,
        }
      }
      return { data: [], error: null }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes debounced answer saves before submit', async () => {
    const { result } = renderHook(() => useVariantAttempt(
      'assign-1',
      'not_started',
      null,
      null,
      null,
      null,
    ))

    act(() => {
      result.current.setAnswer('item-1', '42')
    })

    await act(async () => {
      await result.current.submitVariant()
    })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'save_variant_answer', {
      p_student_assignment_id: 'assign-1',
      p_variant_item_id: 'item-1',
      p_answer_raw: '42',
    })
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'submit_variant', {
      p_student_assignment_id: 'assign-1',
    })
    expect(result.current.attempt?.status).toBe('submitted')

    act(() => {
      vi.runOnlyPendingTimers()
    })
  })
})
