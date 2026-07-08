import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fromSpy = vi.fn()

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

vi.mock('@/utils/notify', () => ({ notifyHomeworkChecked: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let profile: { id: string; role: string } = { id: 'p1', role: 'teacher' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof profile }) => unknown) => selector({ profile }),
}))

import { ReviewHomeworkModal } from '@/components/modals/ReviewHomeworkModal'

const submissionRows = [
  {
    id: 'sub-mine', student_id: 'stud-mine', status: 'submitted',
    answer_text: 'my student answer', file_url: null, score: null, feedback: null, submitted_at: '2026-01-01',
    students: { profile_id: 'profile-mine', profiles: { full_name: 'Мой Ученик' } },
  },
  {
    id: 'sub-other', student_id: 'stud-other', status: 'submitted',
    answer_text: 'other teacher student answer', file_url: null, score: null, feedback: null, submitted_at: '2026-01-01',
    students: { profile_id: 'profile-other', profiles: { full_name: 'Чужой Ученик' } },
  },
]

function setupSupabaseMock() {
  fromSpy.mockImplementation((table: string) => {
    if (table === 'homework_submissions') return makeChain({ data: submissionRows, error: null })
    if (table === 'teachers') return makeChain({ data: { id: 'teacher-1' }, error: null })
    if (table === 'groups') return makeChain({ data: [{ id: 'g1', course_id: 'course-1' }], error: null })
    if (table === 'group_students') return makeChain({ data: [{ student_id: 'stud-mine', group_id: 'g1' }], error: null })
    if (table === 'homeworks') return makeChain({ data: { topics: { modules: { course_id: 'course-1' } } }, error: null })
    return makeChain({ data: [], error: null })
  })
}

const homework = { id: 'hw-1', title: 'ДЗ', max_score: 100 }

describe('ReviewHomeworkModal — scopes submissions to the teacher own groups × course', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    setupSupabaseMock()
  })

  it('teacher sees only their own group students, not another teacher’s students on the same shared homework row', async () => {
    profile = { id: 'p1', role: 'teacher' }
    render(<ReviewHomeworkModal open onClose={vi.fn()} onReviewed={vi.fn()} homework={homework} />)

    await waitFor(() => expect(screen.getByText('Мой Ученик')).toBeInTheDocument())
    expect(screen.queryByTitle('Чужой Ученик')).not.toBeInTheDocument()
    // Only one tab in the student nav bar for a scoped teacher
    expect(screen.getAllByRole('button', { name: /Ученик$/ })).toHaveLength(1)
  })

  it('admin sees every submission on the homework, unscoped', async () => {
    profile = { id: 'admin-1', role: 'admin' }
    render(<ReviewHomeworkModal open onClose={vi.fn()} onReviewed={vi.fn()} homework={homework} />)

    await waitFor(() => expect(screen.getByText('Мой Ученик')).toBeInTheDocument())
    expect(screen.getByTitle('Чужой Ученик')).toBeInTheDocument()
  })
})
