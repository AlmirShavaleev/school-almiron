import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const calls: string[] = []
const state = { role: 'student' }
const attempt = { id: 'attempt1', student_id: 'student1', homework_id: 'hw1', attempt_number: 1, status: 'submitted' }

function chain(table: string) {
  const query: any = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve({ data: { id: 'hw1', is_published: true }, error: null }),
    then: (cb: (value: unknown) => unknown) => Promise.resolve({
      data: table === 'topic_homework_attempts' ? [attempt]
        : table === 'students' ? [{ id: 'student1', profiles: { full_name: 'Ученик Тест' } }]
        : [],
      error: null,
    }).then(cb),
  }
  return query
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => { calls.push(table); return chain(table) },
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ profile: { id: 'profile1', role: state.role } }),
}))
vi.mock('@/lib/readOnlyMode', () => ({ READ_ONLY_MODE: false, READ_ONLY_MESSAGE: 'Технические работы' }))

import { useTopicHomework } from '@/hooks/useTopicHomework'

describe('useTopicHomework — запросы имён', () => {
  beforeEach(() => { calls.length = 0; state.role = 'student' })

  it('не читает students ради имён при открытии ДЗ учеником', async () => {
    const { result } = renderHook(() => useTopicHomework('topic1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.attempts).toHaveLength(1)
    expect(calls).not.toContain('students')
    expect(result.current.studentNames).toEqual({})
  })

  it('для персонала сохраняет отображение имён', async () => {
    state.role = 'teacher'
    const { result } = renderHook(() => useTopicHomework('topic1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(calls).toContain('students')
    expect(result.current.studentNames.student1).toBe('Ученик Тест')
  })
})
