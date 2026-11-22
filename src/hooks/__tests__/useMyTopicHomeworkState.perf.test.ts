import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const reads: Array<{ table: string; columns: string; order?: [string, unknown]; limit?: number }> = []
let active: { table: string; columns: string; order?: [string, unknown]; limit?: number }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      active = { table, columns: '' }
      const query = active
      const chain: any = {
        select: (columns: string) => { query.columns = columns; reads.push(query); return chain },
        eq: () => chain,
        order: (name: string, options: unknown) => { query.order = [name, options]; return chain },
        limit: (count: number) => { query.limit = count; return chain },
        maybeSingle: () => Promise.resolve({
          data: { id: 'hw1', is_published: true, photo_task_numbers: [3] },
          error: null,
        }),
        then: (ok: (r: unknown) => unknown) => Promise.resolve({
          data: [{ attempt_number: 2, status: 'submitted', photo_task_numbers: null }],
          error: null,
        }).then(ok),
      }
      return chain
    },
  },
}))
vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyStudentId: () => ({ studentId: 'student1', loading: false }),
}))
vi.mock('@/store/staffModeStore', () => ({ usePreviewMode: () => false }))

import { useMyTopicHomeworkState } from '@/hooks/useMyTopicHomeworkState'

describe('useMyTopicHomeworkState — число запросов темы', () => {
  it('читает только последнюю попытку и минимальные поля для статуса', async () => {
    reads.length = 0
    const { result } = renderHook(() => useMyTopicHomeworkState('topic1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state).toBe('submitted')
    expect(result.current.hasPhotoSubmission).toBe(true)
    const homework = reads.find(r => r.table === 'topic_homework')
    const attempts = reads.find(r => r.table === 'topic_homework_attempts')
    expect(homework?.columns).toBe('id, is_published, photo_task_numbers')
    expect(attempts?.columns).toBe('attempt_number, status, photo_task_numbers')
    expect(attempts?.order).toEqual(['attempt_number', { ascending: false }])
    expect(attempts?.limit).toBe(1)
  })
})
