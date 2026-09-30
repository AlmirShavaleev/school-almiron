import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

vi.mock('@/lib/rewriteComment', () => ({
  rewriteCommentByTable: vi.fn(async () => ({ text: 'Новый текст по таблице' })),
}))

/**
 * §248. Липкая нижняя полоса спокойного экрана: балл крупно «4 из 5 · по
 * заданиям», комментарий ученику одной строкой с «Править», «Вернуть на
 * доработку» и «Принять · 4». Логика формы та же, что у `bar` (§226):
 * балл едет за таблицей, пока его не тронули руками; возврат — только с
 * комментарием; «Принять» отдаёт балл в `onReview`.
 */

const attempt = {
  id: 'a1', homework_id: 'h1', student_id: 's1', attempt_number: 1, status: 'submitted',
  submitted_at: '2026-09-17T09:00:00Z', created_at: '2026-09-17T08:00:00Z', updated_at: '2026-09-17T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

function calm(over: Partial<React.ComponentProps<typeof ReviewActions>> = {}) {
  const onReview = vi.fn(async () => {})
  const props = {
    layout: 'calm' as const,
    attempt,
    gradeScale: 'five' as const,
    tableScore: 4 as number | null,
    onReview,
    ...over,
  }
  const view = render(<ReviewActions {...props} />)
  return { onReview, rerender: (next: Partial<typeof props>) => view.rerender(<ReviewActions {...props} {...next} />) }
}

describe('ReviewActions — спокойная нижняя полоса', () => {
  it('балл крупно из таблицы, «из 5 · по заданиям», на главной кнопке «Принять · 4»', () => {
    calm()
    expect(screen.getByTestId('review-actions').dataset.layout).toBe('calm')
    expect(screen.getByTestId('review-score-input')).toHaveValue(4)
    expect(screen.getByTestId('review-score-source')).toHaveTextContent('по заданиям')
    expect(screen.getByTestId('review-accept-button')).toHaveTextContent('Принять · 4')
    expect(screen.getByTestId('review-accept-button')).not.toHaveTextContent('б.')
  })

  it('вердикт задания поменялся — балл и «Принять · N» пересчитываются', () => {
    const { rerender } = calm()
    rerender({ tableScore: 3 })
    expect(screen.getByTestId('review-score-input')).toHaveValue(3)
    expect(screen.getByTestId('review-accept-button')).toHaveTextContent('Принять · 3')
  })

  it('балл исправили руками — подпись честно «вручную», таблица больше не подменяет', () => {
    const { rerender } = calm()
    fireEvent.change(screen.getByTestId('review-score-input'), { target: { value: '5' } })
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('вручную, по заданиям 4')
    expect(screen.getByTestId('review-accept-button')).toHaveTextContent('Принять · 5')
    rerender({ tableScore: 2 })
    expect(screen.getByTestId('review-score-input')).toHaveValue(5)
  })

  it('несверенные задания названы под баллом — в балл они не вошли', () => {
    calm({ uncheckedNos: ['17', '18'] })
    expect(screen.getByTestId('review-score-unchecked')).toHaveTextContent('№17, 18 ещё не сверены')
  })

  it('комментарий — одной строкой, «Править» раскрывает поле, «Готово» сворачивает', () => {
    calm({ fillRequest: { comment: 'Работа аккуратная. Ошибки в 4 и 5.' } })
    const preview = screen.getByTestId('review-comment-preview')
    expect(preview).toHaveTextContent('Работа аккуратная. Ошибки в 4 и 5.')
    expect(preview.className).toContain('truncate')
    expect(screen.queryByTestId('review-comment-input')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('review-comment-edit'))
    const input = screen.getByTestId('review-comment-input')
    expect(input).toHaveValue('Работа аккуратная. Ошибки в 4 и 5.')
    fireEvent.change(input, { target: { value: 'Переделай 4.' } })
    fireEvent.click(screen.getByTestId('review-comment-edit'))
    expect(screen.getByTestId('review-comment-preview')).toHaveTextContent('Переделай 4.')
  })

  it('пустой комментарий — «Написать», и «Вернуть» без него недоступно', () => {
    calm()
    expect(screen.getByTestId('review-comment-edit')).toHaveTextContent('Написать')
    expect(screen.getByTestId('review-return-button')).toBeDisabled()
    fireEvent.click(screen.getByTestId('review-comment-edit'))
    fireEvent.change(screen.getByTestId('review-comment-input'), { target: { value: 'Исправь знак' } })
    expect(screen.getByTestId('review-return-button')).toBeEnabled()
  })

  it('«Принять · 4» отдаёт решение, комментарий и балл', async () => {
    const { onReview } = calm({ fillRequest: { comment: 'Хорошо' } })
    fireEvent.click(screen.getByTestId('review-accept-button'))
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', 'Хорошо', 4))
  })

  it('«Вернуть на доработку» — вторичная, рядом с главной; у КР её нет', () => {
    const { rerender } = calm({ fillRequest: { comment: 'Исправь' } })
    expect(screen.getByTestId('review-decision-row')).toContainElement(screen.getByTestId('review-return-button'))
    rerender({ allowReturn: false })
    expect(screen.queryByTestId('review-return-button')).not.toBeInTheDocument()
  })

  it('переписать по таблице — предложение над полосой, «Вставить» кладёт его в комментарий', async () => {
    calm({ canRewriteComment: true })
    fireEvent.click(screen.getByTestId('review-rewrite-button'))
    expect(await screen.findByTestId('review-rewrite-suggestion-text')).toHaveTextContent('Новый текст по таблице')
    fireEvent.click(screen.getByTestId('review-rewrite-apply'))
    expect(screen.getByTestId('review-comment-preview')).toHaveTextContent('Новый текст по таблице')
  })
})
