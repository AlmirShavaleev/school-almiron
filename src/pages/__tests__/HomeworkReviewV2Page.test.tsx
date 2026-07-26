import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { HomeworkV2Row } from '@/types/homeworkV2'
import { HomeworkReviewV2Page } from '@/pages/HomeworkReviewV2Page'

function renderPage() {
  return render(<MemoryRouter><HomeworkReviewV2Page /></MemoryRouter>)
}

let itemsByMode: Record<string, HomeworkV2Row[]> = { pending: [], returned: [], checked: [] }
const reload = vi.fn()
const review = vi.fn().mockResolvedValue({ status: 'accepted' })
let lastMode = 'pending'

vi.mock('@/hooks/useHomeworkReviewQueueV2', () => ({
  useHomeworkReviewQueueV2: (mode: string) => {
    lastMode = mode
    return { items: itemsByMode[mode] || [], loading: false, error: null, reload }
  },
}))

vi.mock('@/hooks/useHomeworkReviewV2', () => ({
  useHomeworkReviewV2: () => ({ review, submitting: false, error: null }),
}))

function row(overrides: Partial<HomeworkV2Row>): HomeworkV2Row {
  return {
    assignment_id: 'a1', template_id: 't1', template_version_id: 'tv1', template_title: 'ДЗ',
    course_id: 'c1', group_id: 'g1', group_name: 'Группа', student_id: 's1', student_name: 'Ученик Иванов',
    status: 'published', publish_at: '2026-01-01T00:00:00Z', due_at: '2026-12-01T00:00:00Z',
    due_at_override: null, effective_due_at: '2026-12-01T00:00:00Z', viewed_at: null,
    is_excused: false, max_attempts: null, allow_late_submission: true, attempts_count: 1,
    latest_attempt_id: 'att1', latest_attempt_number: 1, latest_attempt_status: 'submitted',
    latest_submitted_at: '2026-06-01T00:00:00Z', latest_score: null, latest_review_decision: null,
    latest_review_comment: null, latest_reviewed_at: null, category: 'under_review', overdue: false,
    ...overrides,
  }
}

beforeEach(() => {
  review.mockClear()
  itemsByMode = { pending: [], returned: [], checked: [] }
})

describe('HomeworkReviewV2Page — три вкладки очереди', () => {
  it('под_review (pending): показывает попытку ученика', () => {
    itemsByMode.pending = [row({ template_title: 'На проверке ДЗ' })]
    renderPage()
    expect(screen.getByText('На проверке ДЗ')).toBeInTheDocument()
    expect(screen.getByText('Ученик Иванов')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeInTheDocument()
  })

  it('переключение на «На доработке» запрашивает mode=returned', () => {
    itemsByMode.returned = [row({ template_title: 'Доработка ДЗ', category: 'returned_for_revision' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'На доработке' }))
    expect(lastMode).toBe('returned')
    expect(screen.getByText('Доработка ДЗ')).toBeInTheDocument()
  })

  it('переключение на «Проверенные» запрашивает mode=checked, без кнопки «Проверить», показывает оценку', () => {
    itemsByMode.checked = [row({ template_title: 'Готово ДЗ', category: 'checked', latest_score: 87 })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Проверенные' }))
    expect(lastMode).toBe('checked')
    expect(screen.getByText('Готово ДЗ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
  })

  it('открытие карточки проверки и нажатие «Принять» вызывает review(...,"accepted",...)', () => {
    itemsByMode.pending = [row({ latest_attempt_id: 'att-42' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }))
    expect(review).toHaveBeenCalledWith('att-42', 'accepted', null, '')
  })

  it('нажатие «На доработку» вызывает review(...,"returned_for_revision",...)', () => {
    itemsByMode.pending = [row({ latest_attempt_id: 'att-43' })]
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    fireEvent.click(screen.getByRole('button', { name: 'На доработку' }))
    expect(review).toHaveBeenCalledWith('att-43', 'returned_for_revision', null, '')
  })

  it('пустая очередь показывает «Пусто»', () => {
    renderPage()
    expect(screen.getByText('Пусто')).toBeInTheDocument()
  })
})
