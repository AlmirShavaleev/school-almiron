import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MyProgressPage } from '@/pages/student/MyProgressPage'

const fromSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { profile: { id: string } }) => unknown) =>
    selector({ profile: { id: 'profile-1' } }),
}))

vi.mock('@/hooks/useStudentProfile', () => ({
  useStudentProfile: () => ({
    data: {
      attendance_percent: 95,
      attendance_present: 19,
      attendance_late: 1,
      attendance_absent: 0,
      hw_completion_pct: 80,
      course_progress_pct: 72,
      target_score: 85,
      mock_results: [],
      mock_avg: null,
      recent_attendance: [],
      groups: [],
    },
    loading: false,
  }),
}))

vi.mock('@/hooks/useStudentHomeworkSummary', () => ({
  useStudentHomeworkSummary: () => ({
    summary: {
      new: 1,
      to_do: 2,
      under_review: 3,
      returned_for_revision: 1,
      checked: 4,
      overdue: 2,
      nearest_due_at: '2026-07-24T00:00:00Z',
      nearest_assignment_id: 'a-nearest',
    },
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useMyHomeworkAssignments', () => ({
  useMyHomeworkAssignments: () => ({
    rows: [
      {
        assignment_id: 'a-1',
        template_id: 't-1',
        template_version_id: 'tv-1',
        template_title: 'Просроченное ДЗ',
        course_id: 'course-1',
        group_id: 'group-1',
        group_name: '10А',
        student_id: 'student-1',
        student_name: 'Ученик',
        status: 'published',
        publish_at: '2026-07-01T00:00:00Z',
        due_at: '2026-07-20T00:00:00Z',
        due_at_override: null,
        effective_due_at: '2026-07-20T00:00:00Z',
        viewed_at: '2026-07-02T00:00:00Z',
        is_excused: false,
        max_attempts: null,
        allow_late_submission: true,
        attempts_count: 1,
        latest_attempt_id: 'att-1',
        latest_attempt_number: 1,
        latest_attempt_status: 'returned_for_revision',
        latest_submitted_at: '2026-07-18T00:00:00Z',
        latest_score: 60,
        latest_review_decision: 'returned_for_revision',
        latest_review_comment: 'Доработать',
        latest_reviewed_at: '2026-07-19T00:00:00Z',
        category: 'returned_for_revision',
        overdue: true,
      },
      {
        assignment_id: 'a-2',
        template_id: 't-2',
        template_version_id: 'tv-2',
        template_title: 'Принято 1',
        course_id: 'course-1',
        group_id: 'group-1',
        group_name: '10А',
        student_id: 'student-1',
        student_name: 'Ученик',
        status: 'published',
        publish_at: '2026-07-01T00:00:00Z',
        due_at: '2026-07-22T00:00:00Z',
        due_at_override: null,
        effective_due_at: '2026-07-22T00:00:00Z',
        viewed_at: '2026-07-02T00:00:00Z',
        is_excused: false,
        max_attempts: null,
        allow_late_submission: true,
        attempts_count: 1,
        latest_attempt_id: 'att-2',
        latest_attempt_number: 1,
        latest_attempt_status: 'accepted',
        latest_submitted_at: '2026-07-21T00:00:00Z',
        latest_score: 80,
        latest_review_decision: 'accepted',
        latest_review_comment: 'Хорошо',
        latest_reviewed_at: '2026-07-22T00:00:00Z',
        category: 'checked',
        overdue: false,
      },
      {
        assignment_id: 'a-3',
        template_id: 't-3',
        template_version_id: 'tv-3',
        template_title: 'Принято 2',
        course_id: 'course-1',
        group_id: 'group-1',
        group_name: '10А',
        student_id: 'student-1',
        student_name: 'Ученик',
        status: 'published',
        publish_at: '2026-07-01T00:00:00Z',
        due_at: '2026-07-22T00:00:00Z',
        due_at_override: null,
        effective_due_at: '2026-07-22T00:00:00Z',
        viewed_at: '2026-07-02T00:00:00Z',
        is_excused: false,
        max_attempts: null,
        allow_late_submission: true,
        attempts_count: 1,
        latest_attempt_id: 'att-3',
        latest_attempt_number: 1,
        latest_attempt_status: 'accepted',
        latest_submitted_at: '2026-07-21T00:00:00Z',
        latest_score: 100,
        latest_review_decision: 'accepted',
        latest_review_comment: 'Отлично',
        latest_reviewed_at: '2026-07-22T00:00:00Z',
        category: 'checked',
        overdue: false,
      },
      {
        assignment_id: 'a-4',
        template_id: 't-4',
        template_version_id: 'tv-4',
        template_title: 'Отклонено',
        course_id: 'course-1',
        group_id: 'group-1',
        group_name: '10А',
        student_id: 'student-1',
        student_name: 'Ученик',
        status: 'published',
        publish_at: '2026-07-01T00:00:00Z',
        due_at: '2026-07-22T00:00:00Z',
        due_at_override: null,
        effective_due_at: '2026-07-22T00:00:00Z',
        viewed_at: '2026-07-02T00:00:00Z',
        is_excused: false,
        max_attempts: null,
        allow_late_submission: true,
        attempts_count: 1,
        latest_attempt_id: 'att-4',
        latest_attempt_number: 1,
        latest_attempt_status: 'rejected',
        latest_submitted_at: '2026-07-21T00:00:00Z',
        latest_score: 0,
        latest_review_decision: 'rejected',
        latest_review_comment: 'Не принято',
        latest_reviewed_at: '2026-07-22T00:00:00Z',
        category: 'checked',
        overdue: false,
      },
    ],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('@/components/journal/JournalView', () => ({
  JournalView: () => <div>Journal mock</div>,
}))

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

describe('MyProgressPage — Homework V2', () => {
  it('shows V2 statuses, overdue alert, and averages only accepted scored work', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'students') return makeChain({ data: { id: 'student-1' }, error: null })
      return makeChain({ data: null, error: null })
    })

    render(
      <MemoryRouter>
        <MyProgressPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('нужно сдать')).toBeInTheDocument())
    expect(screen.getByText('на проверке')).toBeInTheDocument()
    expect(screen.getByText('на доработке')).toBeInTheDocument()
    expect(screen.getByText('проверено')).toBeInTheDocument()
    expect(screen.getByText('просрочено')).toBeInTheDocument()
    expect(screen.getByText(/Просроченные задания \(1\)/)).toBeInTheDocument()
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0)
    expect(screen.getByText('по принятым работам')).toBeInTheDocument()
    expect(screen.getByText('Просроченное ДЗ')).toBeInTheDocument()
    expect(screen.queryByText(/Среднее: 60%/)).not.toBeInTheDocument()
  })
})
