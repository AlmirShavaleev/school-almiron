import { describe, expect, it, vi, beforeEach } from 'vitest'

const calls: string[] = []
const studentGate: { resolve: ((value: { data: { id: string } | null }) => void) | null } = { resolve: null }

vi.mock('@/lib/ownStudent', () => ({
  ownStudentRow: () => {
    calls.push('students')
    return new Promise<{ data: { id: string } | null }>(resolve => { studentGate.resolve = resolve })
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(table)
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () => Promise.resolve({
          data: table === 'topics'
            ? { id: 'topic-1', title: 'Lesson' }
            : { id: 'group-1', name: 'Group' },
          error: null,
        }),
        then: (ok: (value: unknown) => unknown) =>
          Promise.resolve({ count: 1, error: null }).then(ok),
      }
      return chain
    },
  },
}))

import { fetchStudentTopicShell } from '@/lib/studentTopicShell'

const params = {
  topicId: 'topic-1',
  groupId: 'group-1',
  profileId: 'student-profile',
  preview: false,
}

describe('fetchStudentTopicShell', () => {
  beforeEach(() => { calls.length = 0; studentGate.resolve = null })

  it('начинает все независимые запросы до ответа students и не отдаёт данные до проверки', async () => {
    const resultPromise = fetchStudentTopicShell(params)
    expect(calls).toEqual(['students', 'topics', 'groups', 'topic_homework', 'topic_test_assignments'])
    studentGate.resolve?.({ data: { id: 'student-1' } })
    const shell = await resultPromise
    expect(shell?.topic).toMatchObject({ id: 'topic-1' })
    expect(shell?.hasHomework).toBe(true)
    expect(shell?.hasTest).toBe(true)
  })

  it('без записи ученика не отдаёт данные оболочки', async () => {
    const resultPromise = fetchStudentTopicShell(params)
    resolveStudent?.({ data: null })
    expect(await resultPromise).toBeNull()
  })

  it('предпросмотр персонала не требует students.id', async () => {
    const result = await fetchStudentTopicShell({ ...params, preview: true })
    expect(calls).not.toContain('students')
    expect(result?.topic).toMatchObject({ id: 'topic-1' })
  })
})
