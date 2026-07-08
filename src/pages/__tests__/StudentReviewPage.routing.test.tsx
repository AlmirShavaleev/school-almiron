import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

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

let profile: { id: string; role: string } = { id: 'profile-1', role: 'teacher' }

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof profile }) => unknown) => selector({ profile }),
}))

vi.mock('@/utils/notify', () => ({ notifyHomeworkChecked: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/pages/reviewScope', () => ({
  loadHomeworkInfo: vi.fn(async () => ({ id: 'hw-1', title: 'Кинематика', max_score: 10, courseId: 'course-1' })),
  loadHomeworkReviewRoster: vi.fn(async () => ({
    homework: { id: 'hw-1', title: 'Кинематика', max_score: 10, courseId: 'course-1' },
    students: [
      { studentId: 'stud-1', name: 'Анна', profileId: 'p1', groupId: 'g1', groupName: 'Группа А', status: 'submitted', score: null, submittedAt: '2026-07-01T10:00:00Z' },
      { studentId: 'stud-2', name: 'Борис', profileId: 'p2', groupId: 'g2', groupName: 'Группа Б', status: 'submitted', score: null, submittedAt: '2026-07-01T11:00:00Z' },
      { studentId: 'stud-3', name: 'Вера', profileId: 'p3', groupId: 'g2', groupName: 'Группа Б', status: 'checked', score: 9, submittedAt: '2026-07-01T12:00:00Z' },
    ],
  })),
}))

import { StudentReviewPage } from '@/pages/StudentReviewPage'

function renderPage(initialEntry = '/homeworks/hw-1/review/student/stud-2') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/homeworks/:id/review" element={<div>review list</div>} />
        <Route path="/homeworks/:id/review/student/:studentId" element={<StudentReviewPage />} />
        <Route path="/homeworks/:id/review/student/:studentId/next" element={<div>next</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudentReviewPage — no-group review mode', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    profile = { id: 'profile-1', role: 'teacher' }

    fromSpy.mockImplementation((table: string) => {
      if (table === 'teachers') return makeChain({ data: { id: 'teacher-1' }, error: null })
      if (table === 'homework_submissions') {
        return makeChain({
          data: {
            id: 'sub-2',
            status: 'submitted',
            answer_text: 'Ответ',
            file_url: null,
            score: null,
            feedback: null,
            submitted_at: '2026-07-01T11:00:00Z',
          },
          error: null,
        })
      }

      return makeChain({ data: [], error: null })
    })
  })

  it('resolves the student group automatically and navigates across grouped siblings', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Борис')).toBeInTheDocument())
    expect(screen.getByText(/Группа: Группа Б/)).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Вера'))

    await waitFor(() => expect(screen.getByText('Вера')).toBeInTheDocument())
  })
})
