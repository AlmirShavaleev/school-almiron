import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

import { HomeworkReviewPage } from '@/pages/HomeworkReviewPage'

function renderPage(initialEntry = '/homeworks/hw-1/review') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/homeworks/:id/review" element={<HomeworkReviewPage />} />
        <Route path="/homeworks/:id/review/:groupId" element={<HomeworkReviewPage />} />
        <Route path="/homeworks/:id/review/student/:studentId" element={<div>student page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomeworkReviewPage — no-group review mode', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    profile = { id: 'profile-1', role: 'teacher' }

    const counts: Record<string, number> = {}
    fromSpy.mockImplementation((table: string) => {
      counts[table] = (counts[table] ?? 0) + 1

      if (table === 'teachers') return makeChain({ data: { id: 'teacher-1' }, error: null })
      if (table === 'homeworks') return makeChain({
        data: { id: 'hw-1', title: 'Кинематика', max_score: 10, topics: { modules: { course_id: 'course-1' } } },
        error: null,
      })
      if (table === 'groups') return makeChain({
        data: [
          { id: 'g1', name: 'Группа А' },
          { id: 'g2', name: 'Группа Б' },
        ],
        error: null,
      })
      if (table === 'group_students') return makeChain({
        data: [
          { group_id: 'g1', student_id: 'stud-1', students: { id: 'stud-1', profile_id: 'p1', profiles: { full_name: 'Анна' } } },
          { group_id: 'g1', student_id: 'stud-2', students: { id: 'stud-2', profile_id: 'p2', profiles: { full_name: 'Борис' } } },
          { group_id: 'g2', student_id: 'stud-3', students: { id: 'stud-3', profile_id: 'p3', profiles: { full_name: 'Вера' } } },
        ],
        error: null,
      })
      if (table === 'homework_submissions') return makeChain({
        data: [
          { student_id: 'stud-2', status: 'checked', score: 9, submitted_at: '2026-07-01T10:00:00Z' },
          { student_id: 'stud-3', status: 'submitted', score: null, submitted_at: '2026-07-01T11:00:00Z' },
        ],
        error: null,
      })

      return makeChain({ data: [], error: null })
    })
  })

  it('aggregates students across the teacher course groups and keeps group-by-group order', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Анна')).toBeInTheDocument())
    expect(screen.getByText('Борис')).toBeInTheDocument()
    expect(screen.getByText('Вера')).toBeInTheDocument()
    expect(screen.getAllByText('Группа А')).not.toHaveLength(0)
    expect(screen.getAllByText('Группа Б')).not.toHaveLength(0)

    const names = screen.getAllByRole('button').map(node => node.textContent ?? '')
    expect(names.findIndex(text => text.includes('Анна'))).toBeLessThan(names.findIndex(text => text.includes('Вера')))
    expect(names.findIndex(text => text.includes('Борис'))).toBeLessThan(names.findIndex(text => text.includes('Вера')))
  })
})
