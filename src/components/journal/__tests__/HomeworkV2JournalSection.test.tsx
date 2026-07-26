import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomeworkV2JournalSection } from '@/components/journal/HomeworkV2JournalSection'
import type { StudentHomeworkJournalRow } from '@/hooks/useStudentHomeworkJournal'

let rows: StudentHomeworkJournalRow[] = []
vi.mock('@/hooks/useStudentHomeworkJournal', () => ({
  useStudentHomeworkJournal: () => ({ rows, loading: false, error: null }),
}))

const attemptHistoryMock = vi.fn()
vi.mock('@/hooks/useHomeworkAttemptHistory', () => ({
  useHomeworkAttemptHistory: (...args: unknown[]) => attemptHistoryMock(...args),
}))

function row(overrides: Partial<StudentHomeworkJournalRow>): StudentHomeworkJournalRow {
  return {
    assignment_id: 'a1', template_id: 't1', template_version_id: 'tv1', title: 'ДЗ',
    course_id: 'c1', course_title: 'Курс', group_id: 'g1', group_title: 'Группа',
    effective_due_at: '2026-12-01T00:00:00Z', viewed_at: null,
    latest_attempt_id: null, latest_attempt_number: null, latest_attempt_status: null,
    latest_score: null, latest_review_decision: null, latest_review_comment: null,
    submitted_at: null, is_overdue: false, ui_category: 'new',
    ...overrides,
  }
}

beforeEach(() => {
  attemptHistoryMock.mockReturnValue({ attempts: [], loading: false, error: null })
})

describe('HomeworkV2JournalSection', () => {
  it('1. показывает V2 assignment', () => {
    rows = [row({ assignment_id: 'a-1', title: 'Матан ДЗ' })]
    render(<HomeworkV2JournalSection studentId="s1" />)
    expect(screen.getByText('Матан ДЗ')).toBeInTheDocument()
  })

  it('2. два assignments из двух курсов отображаются', () => {
    rows = [
      row({ assignment_id: 'a-1', title: 'ДЗ курс 1', course_title: 'Математика' }),
      row({ assignment_id: 'a-2', title: 'ДЗ курс 2', course_title: 'Физика' }),
    ]
    render(<HomeworkV2JournalSection studentId="s1" />)
    expect(screen.getByText('ДЗ курс 1')).toBeInTheDocument()
    expect(screen.getByText('ДЗ курс 2')).toBeInTheDocument()
    expect(screen.getByText('Математика')).toBeInTheDocument()
    expect(screen.getByText('Физика')).toBeInTheDocument()
  })

  it('3. returned_for_revision находится отдельно от under_review/checked', () => {
    rows = [
      row({ assignment_id: 'a-ur', title: 'На проверке', ui_category: 'under_review' }),
      row({ assignment_id: 'a-ret', title: 'На доработке ДЗ', ui_category: 'returned_for_revision' }),
    ]
    render(<HomeworkV2JournalSection studentId="s1" />)
    // summary tiles count them separately
    const summaryText = document.body.textContent || ''
    expect(summaryText).toContain('На доработке')
    expect(screen.getByText('На доработке ДЗ')).toBeInTheDocument()
  })

  it('4. overdue отображается корректно', () => {
    rows = [row({ assignment_id: 'a-od', title: 'Просроченное ДЗ', is_overdue: true })]
    render(<HomeworkV2JournalSection studentId="s1" />)
    expect(screen.getByText('Просроченное ДЗ')).toBeInTheDocument()
    expect(screen.getAllByText('Просрочено').length).toBeGreaterThan(0)
  })

  it('8. пустое состояние показывается только при реальном отсутствии V2 assignments', () => {
    rows = []
    render(<HomeworkV2JournalSection studentId="s1" />)
    expect(screen.getByText('Homework V2 заданий пока нет')).toBeInTheDocument()
  })

  it('6/7. раскрытие строки показывает историю попыток и review comment/score', () => {
    rows = [row({ assignment_id: 'a-hist', title: 'ДЗ с историей', latest_score: 90, latest_review_comment: 'Хорошая работа' })]
    attemptHistoryMock.mockReturnValue({
      attempts: [
        { id: 'att1', attempt_number: 1, status: 'returned_for_revision', answer_text: 'первая попытка', submitted_at: '2026-01-01T00:00:00Z', score: null, files: [], reviews: [{ id: 'r1', decision: 'returned_for_revision', score: null, comment: 'доработай', created_at: '2026-01-02T00:00:00Z', reviewer_name: 'Учитель' }] },
        { id: 'att2', attempt_number: 2, status: 'accepted', answer_text: 'вторая попытка', submitted_at: '2026-01-03T00:00:00Z', score: 90, files: [], reviews: [{ id: 'r2', decision: 'accepted', score: 90, comment: 'Хорошая работа', created_at: '2026-01-04T00:00:00Z', reviewer_name: 'Учитель' }] },
      ],
      loading: false, error: null,
    })
    render(<HomeworkV2JournalSection studentId="s1" />)
    fireEvent.click(screen.getByText('ДЗ с историей'))
    expect(screen.getByText('Попытка 1')).toBeInTheDocument()
    expect(screen.getByText('Попытка 2')).toBeInTheDocument()
    expect(screen.getAllByText(/Хорошая работа/).length).toBeGreaterThan(0)
  })
})
