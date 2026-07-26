import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentDashboard } from '@/pages/student/StudentDashboard'

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', full_name: 'Almir Shavaleev' } }),
}))

const useStudentDashboardMock = vi.fn()
vi.mock('@/hooks/useStudentDashboard', () => ({
  useStudentDashboard: (...args: unknown[]) => useStudentDashboardMock(...args),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ subscription: null, loading: false }),
}))

const useMyCourseMembershipsMock = vi.fn()
vi.mock('@/hooks/useMyCourseMemberships', () => ({
  useMyCourseMemberships: (...args: unknown[]) => useMyCourseMembershipsMock(...args),
}))

const useStudentHomeworkSummaryMock = vi.fn()
vi.mock('@/hooks/useStudentHomeworkSummary', () => ({
  useStudentHomeworkSummary: (...args: unknown[]) => useStudentHomeworkSummaryMock(...args),
}))

const useMyHomeworkAssignmentsMock = vi.fn()
vi.mock('@/hooks/useMyHomeworkAssignments', () => ({
  useMyHomeworkAssignments: (...args: unknown[]) => useMyHomeworkAssignmentsMock(...args),
}))

const baseDashboard = {
  student: { id: 'student-1', target_score: 80, target_exam: 'ege' },
  nextLesson: null,
  mockResults: [],
  recommendations: [],
  attendanceRate: 0,
  loading: false,
}

const emptyHwSummary = {
  new: 0, to_do: 0, under_review: 0, returned_for_revision: 0, checked: 0, overdue: 0,
  nearest_due_at: null, nearest_assignment_id: null,
}

function hwRow(overrides: Record<string, unknown>) {
  return {
    assignment_id: 'a1', template_id: 't1', template_version_id: 'tv1', template_title: 'ДЗ',
    course_id: 'c1', group_id: 'g1', group_name: 'Группа', student_id: 's1', student_name: 'Ученик',
    status: 'published', publish_at: '2026-01-01T00:00:00Z', due_at: '2026-12-01T00:00:00Z',
    due_at_override: null, effective_due_at: '2026-12-01T00:00:00Z', viewed_at: null,
    is_excused: false, max_attempts: null, allow_late_submission: true, attempts_count: 0,
    latest_attempt_id: null, latest_attempt_number: null, latest_attempt_status: null,
    latest_submitted_at: null, latest_score: null, latest_review_decision: null,
    latest_review_comment: null, latest_reviewed_at: null, category: 'new', overdue: false,
    ...overrides,
  }
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <StudentDashboard />
    </MemoryRouter>,
  )
}

describe('StudentDashboard course selector', () => {
  it('shows the real course, not an empty block, when group-based memberships exist', () => {
    useStudentDashboardMock.mockReturnValue(baseDashboard)
    useStudentHomeworkSummaryMock.mockReturnValue({ summary: emptyHwSummary, loading: false, error: null })
    useMyHomeworkAssignmentsMock.mockReturnValue({ rows: [], loading: false, error: null, reload: vi.fn() })
    useMyCourseMembershipsMock.mockReturnValue({
      courses: [{
        courseId: 'course-1',
        title: 'Физика ЕГЭ',
        subject: 'physics',
        examType: 'ege',
        groups: [{ groupId: 'group-1', groupTitle: 'Индивидуально · Almir', groupType: 'individual' }],
        primaryGroupId: 'group-1',
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
    })

    renderDashboard()

    expect(screen.getByText('Физика ЕГЭ')).toBeInTheDocument()
  })

  it('renders no selector when the student truly has no memberships', () => {
    useStudentDashboardMock.mockReturnValue(baseDashboard)
    useStudentHomeworkSummaryMock.mockReturnValue({ summary: emptyHwSummary, loading: false, error: null })
    useMyHomeworkAssignmentsMock.mockReturnValue({ rows: [], loading: false, error: null, reload: vi.fn() })
    useMyCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })

    renderDashboard()

    expect(screen.queryByText(/групп/)).not.toBeInTheDocument()
  })
})

describe('StudentDashboard — Homework V2 (не читает legacy homeworks/homework_submissions)', () => {
  beforeEach(() => {
    useStudentDashboardMock.mockReturnValue(baseDashboard)
    useMyCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })
  })

  it('показывает новое задание (category=new) в списке ДЗ', () => {
    useStudentHomeworkSummaryMock.mockReturnValue({ summary: { ...emptyHwSummary, new: 1 }, loading: false, error: null })
    useMyHomeworkAssignmentsMock.mockReturnValue({
      rows: [hwRow({ assignment_id: 'a-new', template_title: 'Новое ДЗ', category: 'new' })],
      loading: false, error: null, reload: vi.fn(),
    })
    renderDashboard()
    expect(screen.getByText('Новое ДЗ')).toBeInTheDocument()
  })

  it('returned_for_revision показывается отдельно (не путается с checked/under_review)', () => {
    useStudentHomeworkSummaryMock.mockReturnValue({ summary: { ...emptyHwSummary, returned_for_revision: 1 }, loading: false, error: null })
    useMyHomeworkAssignmentsMock.mockReturnValue({
      rows: [hwRow({ assignment_id: 'a-ret', template_title: 'Доработка ДЗ', category: 'returned_for_revision' })],
      loading: false, error: null, reload: vi.fn(),
    })
    renderDashboard()
    expect(screen.getByText('Доработка ДЗ')).toBeInTheDocument()
    expect(screen.getByText('На доработке')).toBeInTheDocument()
  })

  it('overdue помечается бейджем «Просрочено» и попадает в срочный алерт', () => {
    useStudentHomeworkSummaryMock.mockReturnValue({ summary: { ...emptyHwSummary, to_do: 1, overdue: 1 }, loading: false, error: null })
    useMyHomeworkAssignmentsMock.mockReturnValue({
      rows: [hwRow({ assignment_id: 'a-od', template_title: 'Просроченное ДЗ', category: 'to_do', overdue: true, effective_due_at: '2020-01-01T00:00:00Z' })],
      loading: false, error: null, reload: vi.fn(),
    })
    renderDashboard()
    expect(screen.getByText(/Просрочено/)).toBeInTheDocument()
    expect(screen.getByText('Срочно сдать!')).toBeInTheDocument()
  })
})
