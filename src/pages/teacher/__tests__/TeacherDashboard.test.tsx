import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', full_name: 'Виктор Андреев' } }),
}))

const useTeacherDashboardMock = vi.fn()
vi.mock('@/hooks/useTeacherDashboard', () => ({
  useTeacherDashboard: (...args: unknown[]) => useTeacherDashboardMock(...args),
}))

const useTeacherHomeworkSummaryMock = vi.fn()
vi.mock('@/hooks/useTeacherHomeworkSummary', () => ({
  useTeacherHomeworkSummary: (...args: unknown[]) => useTeacherHomeworkSummaryMock(...args),
}))

const baseDashboard = {
  groups: [], lessons: [], stats: { total_groups: 0, total_students: 0, today_lessons: 0 },
  todayLessons: [], loading: false, reload: vi.fn(),
}

const emptySummary = {
  active_assignments: 0, scheduled_assignments: 0, attempts_awaiting_review: 0,
  returned_for_revision: 0, overdue_recipients: 0, accepted_today: 0, accepted_this_week: 0,
  groups_with_overdue_homework: 0, recently_assigned: [],
}

function renderDashboard() {
  return render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)
}

beforeEach(() => {
  useTeacherDashboardMock.mockReturnValue(baseDashboard)
})

describe('TeacherDashboard — Homework V2 (не читает legacy homeworks/homework_submissions)', () => {
  it('показывает попытки, ожидающие проверки (pending)', () => {
    useTeacherHomeworkSummaryMock.mockReturnValue({ summary: { ...emptySummary, attempts_awaiting_review: 3 }, loading: false, error: null })
    renderDashboard()
    expect(screen.getByText('Ожидают проверки')).toBeInTheDocument()
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('показывает returned_for_revision отдельной строкой от pending', () => {
    useTeacherHomeworkSummaryMock.mockReturnValue({ summary: { ...emptySummary, attempts_awaiting_review: 1, returned_for_revision: 2 }, loading: false, error: null })
    renderDashboard()
    expect(screen.getByText('Ожидают проверки')).toBeInTheDocument()
    expect(screen.getByText('На доработке у учеников')).toBeInTheDocument()
  })

  it('пустая сводка -> "Все работы проверены"', () => {
    useTeacherHomeworkSummaryMock.mockReturnValue({ summary: emptySummary, loading: false, error: null })
    renderDashboard()
    expect(screen.getByText('Все работы проверены')).toBeInTheDocument()
  })

  it('недавно назначенные ДЗ отображаются со сроком', () => {
    useTeacherHomeworkSummaryMock.mockReturnValue({
      summary: {
        ...emptySummary, attempts_awaiting_review: 1,
        recently_assigned: [{ assignment_id: 'a1', template_title: 'Матан ДЗ', group_name: '11А', publish_at: '2026-01-01', due_at: '2026-02-01' }],
      },
      loading: false, error: null,
    })
    renderDashboard()
    expect(screen.getByText(/Матан ДЗ/)).toBeInTheDocument()
  })

  it('карточка "На проверке" использует V2-сводку, не legacy pendingSubs', () => {
    useTeacherHomeworkSummaryMock.mockReturnValue({ summary: { ...emptySummary, attempts_awaiting_review: 7 }, loading: false, error: null })
    renderDashboard()
    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
  })
})
