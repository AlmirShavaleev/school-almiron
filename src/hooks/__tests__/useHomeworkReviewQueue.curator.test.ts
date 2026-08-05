import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * Куратор курса — это часто ученик другого курса, и RLS отдаёт ему ДВА
 * набора сразу: сдачи курируемого курса (через `course_is_staff` →
 * `course_curators`) и его собственные (`student_id = auth_student_id()`).
 * Проба на проде 2026-08-05 это подтвердила: ученику-куратору было видно
 * 8 попыток, из которых 2 — его собственные.
 *
 * Очередь проверки обязана убрать вторые: сам себя человек не проверяет.
 */

const CURATED_COURSE = 'c-curated'
const OWN_STUDENT = 'students-row-of-curator'

function attempt(id: string, studentId: string, courseId: string) {
  return {
    id,
    student_id: studentId,
    homework_id: `hw-${id}`,
    status: 'submitted',
    submitted_at: '2026-08-05T10:00:00.000Z',
    homework: {
      id: `hw-${id}`,
      title: 'ДЗ',
      grade_scale: null,
      due_at: null,
      topic: {
        id: 't1',
        title: 'Тема',
        module: { id: 'm1', course: { id: courseId, title: 'Курс' } },
      },
    },
  }
}

const ROWS = [
  attempt('a-student-1', 'someone-else', CURATED_COURSE),
  attempt('a-student-2', 'another-one',  CURATED_COURSE),
  attempt('a-own',       OWN_STUDENT,    'c-where-i-study'),
]

let scope: TeachingScope

vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => scope,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'order']) chain[m] = () => chain
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: ROWS, error: null }).then(onFulfilled)
      return chain
    },
  },
}))

describe('очередь проверки у куратора курса', () => {
  beforeEach(() => {
    scope = {
      active: true,
      loading: false,
      teacherId: null,
      courseIds: [CURATED_COURSE],
      groupIds: ['g-curated'],
      ownStudentId: OWN_STUDENT,
      readOnly: true, // куратор: §94
    }
  })

  it('свои сдачи в очередь не попадают', async () => {
    const { result } = renderHook(() => useHomeworkReviewQueue('submitted'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ids = result.current.all.map(r => r.attempt.id).sort()
    expect(ids).toEqual(['a-student-1', 'a-student-2'])
    expect(ids).not.toContain('a-own')
  })

  it('счётчик вкладки считается после того, как свои убраны', async () => {
    const { result } = renderHook(() => useHomeworkReviewQueue('submitted'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 3 видимых попытки, но проверять человеку нечего сверх двух чужих.
    expect(result.current.counts.submitted).toBe(2)
  })

  it('без своей строки students (владелец, преподаватель) фильтр вырождается', async () => {
    scope = { ...scope, ownStudentId: null, courseIds: [CURATED_COURSE, 'c-where-i-study'] }

    const { result } = renderHook(() => useHomeworkReviewQueue('submitted'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.all).toHaveLength(3)
  })
})
