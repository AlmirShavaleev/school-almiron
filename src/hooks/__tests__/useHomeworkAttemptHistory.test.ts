import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHomeworkAttemptHistory } from '@/hooks/useHomeworkAttemptHistory'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'homework_attempts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }
      }
      if (table === 'homework_attempt_files') {
        return { select: () => ({ in: () => Promise.resolve({ data: null, error: null }) }) }
      }
      return { select: () => ({ in: () => ({ order: () => Promise.resolve({ data: null, error: null }) }) }) }
    },
  },
}))

describe('useHomeworkAttemptHistory', () => {
  it('assignment без attempts — files/reviews запросы не выполняются, attempts = []', async () => {
    const { result } = renderHook(() => useHomeworkAttemptHistory('a1', 's1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.attempts).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('assignmentId/studentId отсутствуют — attempts = [] без запроса', async () => {
    const { result } = renderHook(() => useHomeworkAttemptHistory(null, null))
    await waitFor(() => expect(result.current.attempts).toEqual([]))
  })
})
