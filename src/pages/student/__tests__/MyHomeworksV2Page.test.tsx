import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { HomeworkV2Row } from '@/types/homeworkV2'
import { MyHomeworksV2Page } from '@/pages/student/MyHomeworksV2Page'

let mockRows: HomeworkV2Row[] = []
const submitAttempt = vi.fn().mockResolvedValue({ status: 'submitted' })
const reload = vi.fn()

vi.mock('@/hooks/useMyHomeworkAssignments', () => ({
  useMyHomeworkAssignments: () => ({ rows: mockRows, loading: false, error: null, reload }),
}))

vi.mock('@/hooks/useHomeworkAttemptV2', () => ({
  useHomeworkAttemptV2: () => ({ submitAttempt, submitting: false, error: null }),
}))

function row(overrides: Partial<HomeworkV2Row>): HomeworkV2Row {
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

describe('MyHomeworksV2Page — категории (server-derived, проверяем что UI их корректно отображает по вкладкам)', () => {
  it('new: показывается во вкладке «Новые», кнопка «Сдать»', () => {
    mockRows = [row({ assignment_id: 'a-new', template_title: 'Новое ДЗ', category: 'new' })]
    render(<MyHomeworksV2Page />)
    fireEvent.click(screen.getByRole('button', { name: /Новые/ }))
    expect(screen.getByText('Новое ДЗ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сдать' })).toBeInTheDocument()
  })

  it('to_do: вкладка «Нужно сдать» (дефолтная)', () => {
    mockRows = [row({ assignment_id: 'a-todo', template_title: 'Нужно сдать ДЗ', category: 'to_do' })]
    render(<MyHomeworksV2Page />)
    expect(screen.getByText('Нужно сдать ДЗ')).toBeInTheDocument()
  })

  it('under_review: карточка без кнопки «Сдать»/«Пересдать»', () => {
    mockRows = [row({ assignment_id: 'a-ur', template_title: 'На проверке ДЗ', category: 'under_review', attempts_count: 1 })]
    render(<MyHomeworksV2Page />)
    fireEvent.click(screen.getByRole('button', { name: /На проверке/ }))
    expect(screen.getByText('На проверке ДЗ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сдать' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Пересдать' })).not.toBeInTheDocument()
  })

  it('returned_for_revision: отдельная вкладка «На доработке», показывает комментарий/оценку, кнопка «Пересдать»', () => {
    mockRows = [row({
      assignment_id: 'a-ret', template_title: 'Доработать ДЗ', category: 'returned_for_revision',
      attempts_count: 1, latest_score: 60, latest_review_comment: 'Исправь пункт 2',
    })]
    render(<MyHomeworksV2Page />)
    fireEvent.click(screen.getByRole('button', { name: /На доработке/ }))
    expect(screen.getByText('Доработать ДЗ')).toBeInTheDocument()
    expect(screen.getByText(/Исправь пункт 2/)).toBeInTheDocument()
    expect(screen.getByText(/60/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Пересдать' })).toBeInTheDocument()
  })

  it('checked (accepted): вкладка «Проверено», без кнопки сдачи', () => {
    mockRows = [row({ assignment_id: 'a-acc', template_title: 'Принято ДЗ', category: 'checked', latest_review_decision: 'accepted', latest_score: 100 })]
    render(<MyHomeworksV2Page />)
    fireEvent.click(screen.getByRole('button', { name: /Проверено/ }))
    expect(screen.getByText('Принято ДЗ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сдать' })).not.toBeInTheDocument()
  })

  it('checked (rejected): тоже попадает во вкладку «Проверено»', () => {
    mockRows = [row({ assignment_id: 'a-rej', template_title: 'Отклонено ДЗ', category: 'checked', latest_review_decision: 'rejected', latest_score: 0 })]
    render(<MyHomeworksV2Page />)
    fireEvent.click(screen.getByRole('button', { name: /Проверено/ }))
    expect(screen.getByText('Отклонено ДЗ')).toBeInTheDocument()
  })

  it('overdue: карточка помечена бейджем «Просрочено»', () => {
    mockRows = [row({ assignment_id: 'a-od', template_title: 'Просроченное ДЗ', category: 'to_do', overdue: true })]
    render(<MyHomeworksV2Page />)
    const card = screen.getByText('Просроченное ДЗ').closest('div')!.parentElement!.parentElement!
    expect(within(card).getByText('Просрочено')).toBeInTheDocument()
  })

  it('excused: бейдж «Освобождён», кнопка сдачи скрыта даже во вкладке to_do', () => {
    mockRows = [row({ assignment_id: 'a-exc', template_title: 'Освобождённое ДЗ', category: 'to_do', is_excused: true })]
    render(<MyHomeworksV2Page />)
    expect(screen.getByText('Освобождённое ДЗ')).toBeInTheDocument()
    expect(screen.getByText('Освобождён')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сдать' })).not.toBeInTheDocument()
  })

  it('scheduled (не опубликовано): сервер не возвращает такие строки — пустой список, значит и в UI пусто', () => {
    mockRows = []
    render(<MyHomeworksV2Page />)
    expect(screen.getByText('Пусто')).toBeInTheDocument()
  })

  it('счётчики вкладок соответствуют числу строк каждой категории', () => {
    mockRows = [
      row({ assignment_id: '1', category: 'new' }),
      row({ assignment_id: '2', category: 'new' }),
      row({ assignment_id: '3', category: 'to_do' }),
    ]
    render(<MyHomeworksV2Page />)
    expect(screen.getByRole('button', { name: /Новые \(2\)/ })).toBeInTheDocument()
  })
})
