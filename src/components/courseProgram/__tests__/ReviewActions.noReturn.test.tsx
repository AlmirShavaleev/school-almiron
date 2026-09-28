import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

vi.mock('@/lib/rewriteComment', () => ({ rewriteCommentByTable: vi.fn() }))

/**
 * §240. У проверочной и контрольной одна попытка: «Вернуть на доработку» нет
 * ни в нижней строке экрана проверки, ни в прежней форме — только оценка.
 */

const attempt = {
  id: 'a1', homework_id: 'h1', student_id: 's1', attempt_number: 1, status: 'submitted',
  submitted_at: '2026-10-02T07:45:00Z', created_at: '', updated_at: '',
} as unknown as TopicHomeworkAttemptRow

describe('ReviewActions без возврата (§240)', () => {
  it.each(['bar', 'form'] as const)('раскладка %s: только «Принять», комментарий необязателен', layout => {
    render(<ReviewActions layout={layout} attempt={attempt} gradeScale="five" onReview={vi.fn()} allowReturn={false} />)
    expect(screen.getByTestId('review-accept-button')).toBeInTheDocument()
    expect(screen.queryByTestId('review-return-button')).not.toBeInTheDocument()
    expect(screen.queryByText('Для возврата нужен комментарий')).not.toBeInTheDocument()
    expect(screen.getByTestId('review-comment-input').getAttribute('placeholder')).not.toMatch(/возврат/)
  })

  it('по умолчанию возврат на месте — обычные ДЗ не изменились', () => {
    render(<ReviewActions layout="bar" attempt={attempt} gradeScale="five" onReview={vi.fn()} />)
    expect(screen.getByTestId('review-return-button')).toBeInTheDocument()
  })
})
