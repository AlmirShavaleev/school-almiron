import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const rpcSpy = vi.fn()
const testProfile = { id: 'p1', role: 'admin' }

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcSpy(...args) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof testProfile }) => unknown) => selector({ profile: testProfile }),
}))

import { useHomeworkQueue } from '@/hooks/useHomeworkQueue'

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const queueCalls = () => rpcSpy.mock.calls.filter(c => c[0] === 'get_review_queue').length
const countCalls = () => rpcSpy.mock.calls.filter(c => c[0] === 'get_review_queue_counts').length

describe('useHomeworkQueue focus/visibilitychange reload guard', () => {
  let now = 1_000_000

  beforeEach(() => {
    rpcSpy.mockReset()
    rpcSpy.mockImplementation((fn: string, args?: any) => {
      if (fn === 'get_review_queue') {
        return Promise.resolve({
          data: {
            items: args?.p_cursor ? [
              {
                source: 'legacy_homework',
                submission_id: 'sub-2',
                assignment_id: 'hw-2',
                student_id: 'student-2',
                student_name: 'Борис',
                course_id: 'course-1',
                course_title: 'Курс',
                group_ids: ['group-1'],
                group_titles: ['Группа'],
                topic_id: 'topic-1',
                topic_title: 'Тема',
                lesson_id: null,
                title: 'ДЗ 2',
                due_at: '2026-07-20T10:00:00Z',
                submitted_at: '2026-07-19T10:00:00Z',
                reviewed_at: null,
                status: 'submitted',
                score: null,
                has_files: false,
                is_overdue: false,
              },
            ] : [
              {
                source: 'legacy_homework',
                submission_id: 'sub-1',
                assignment_id: 'hw-1',
                student_id: 'student-1',
                student_name: 'Анна',
                course_id: 'course-1',
                course_title: 'Курс',
                group_ids: ['group-1'],
                group_titles: ['Группа'],
                topic_id: 'topic-1',
                topic_title: 'Тема',
                lesson_id: null,
                title: 'ДЗ 1',
                due_at: '2026-07-19T12:00:00Z',
                submitted_at: '2026-07-19T09:00:00Z',
                reviewed_at: null,
                status: 'submitted',
                score: null,
                has_files: true,
                is_overdue: false,
              },
            ],
            has_more: !args?.p_cursor,
            next_cursor: args?.p_cursor ? null : {
              mode: 'pending',
              has_sort_value: true,
              sort_value: '2026-07-19T12:00:00Z',
              source: 'legacy_homework',
              assignment_id: 'hw-1',
              student_id: 'student-1',
            },
          },
          error: null,
        })
      }

      if (fn === 'get_review_queue_counts') {
        return Promise.resolve({
          data: [
            { bucket: 'pending', count: 3 },
            { bucket: 'returned', count: 1 },
            { bucket: 'checked', count: 2 },
          ],
          error: null,
        })
      }

      return Promise.resolve({ data: null, error: null })
    })
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  it('loads queue page and counts once on mount', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(queueCalls()).toBe(1)
    expect(countCalls()).toBe(1)
  })

  it('ignores a focus/visibilitychange burst inside the 30s throttle window', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(queueCalls()).toBe(1)

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('focus'))
        document.dispatchEvent(new Event('visibilitychange'))
      }
      await Promise.resolve()
    })

    expect(queueCalls()).toBe(1)
  })

  it('refetches on focus once the 30s throttle window has passed', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(queueCalls()).toBe(1)

    now += 31_000
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(queueCalls()).toBe(2)
  })

  it('manual reload() always refetches, ignoring the throttle window', async () => {
    const { result } = renderHook(() => useHomeworkQueue())
    await flush()
    expect(queueCalls()).toBe(1)

    await act(async () => { result.current.reload() })
    await flush()
    expect(queueCalls()).toBe(2)
  })

  it('loads the next page via cursor pagination', async () => {
    const { result } = renderHook(() => useHomeworkQueue())
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.hasMore).toBe(true)

    await act(async () => {
      await result.current.loadMore()
    })

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasMore).toBe(false)
    const cursorCall = rpcSpy.mock.calls.find(call => call[0] === 'get_review_queue' && call[1]?.p_cursor)
    expect(cursorCall?.[1]?.p_cursor).toMatchObject({ assignment_id: 'hw-1', student_id: 'student-1' })
  })
})
