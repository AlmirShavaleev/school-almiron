import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { BAR_COMMENT_ROWS } from '@/lib/reviewCommentBox'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

vi.mock('@/lib/rewriteComment', () => ({
  rewriteCommentByTable: vi.fn(async () => ({ text: 'Новый текст по таблице' })),
}))

/**
 * §226. Форма вердикта нижней строкой экрана проверки: та же логика, другая
 * раскладка. «Балл [4] из 5 · №6 ещё не сверено», комментарий, «Вернуть на
 * доработку», «Принять · 4 б.» — главная кнопка одна.
 */

const attempt = {
  id: 'a1', homework_id: 'h1', student_id: 's1', attempt_number: 1, status: 'submitted',
  submitted_at: '2026-09-17T09:00:00Z', created_at: '2026-09-17T08:00:00Z', updated_at: '2026-09-17T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

function bar(over: Partial<React.ComponentProps<typeof ReviewActions>> = {}) {
  const onReview = vi.fn(async () => {})
  render(
    <ReviewActions
      layout="bar"
      attempt={attempt}
      gradeScale="five"
      tableScore={4}
      uncheckedNos={['6']}
      onReview={onReview}
      {...over}
    />,
  )
  return { onReview }
}

describe('ReviewActions — нижняя строка', () => {
  it('балл из таблицы, «из 5», несверенные и балл на главной кнопке', () => {
    bar()
    expect(screen.getByTestId('review-actions').dataset.layout).toBe('bar')
    expect(screen.getByTestId('review-score-input')).toHaveValue(4)
    expect(screen.getByTestId('review-score-unchecked')).toHaveTextContent('№6 ещё не сверено')
    expect(screen.getByTestId('review-accept-button')).toHaveTextContent('Принять · 4 б.')
    // Пока балл совпадает с таблицей, «рекомендуемый» не повторяется.
    expect(screen.queryByTestId('review-score-from-table')).not.toBeInTheDocument()
  })

  it('балл поменяли руками — рядом рекомендация таблицы, кнопка с новым баллом', () => {
    bar()
    fireEvent.change(screen.getByTestId('review-score-input'), { target: { value: '5' } })
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('рекомендуемый балл 4')
    expect(screen.getByTestId('review-accept-button')).toHaveTextContent('Принять · 5 б.')
  })

  it('поле компактное — две строки, а не шесть', () => {
    bar()
    expect((screen.getByTestId('review-comment-input') as HTMLTextAreaElement).rows).toBe(BAR_COMMENT_ROWS)
  })

  it('вернуть без комментария нельзя, с комментарием — уходит с текстом', async () => {
    const { onReview } = bar()
    expect(screen.getByTestId('review-return-button')).toBeDisabled()
    fireEvent.change(screen.getByTestId('review-comment-input'), { target: { value: 'Исправь №3' } })
    fireEvent.click(screen.getByTestId('review-return-button'))
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'returned_for_revision', 'Исправь №3', null))
  })

  it('принять — с баллом', async () => {
    const { onReview } = bar()
    fireEvent.click(screen.getByTestId('review-accept-button'))
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', '', 4))
  })

  it('«Переписать по таблице» — в углу поля, результат предложением, поле не трогается', async () => {
    bar({ canRewriteComment: true })
    fireEvent.change(screen.getByTestId('review-comment-input'), { target: { value: 'моё' } })
    fireEvent.click(screen.getByTestId('review-rewrite-button'))
    await waitFor(() => expect(screen.getByTestId('review-rewrite-suggestion-text')).toHaveTextContent('Новый текст по таблице'))
    expect(screen.getByTestId('review-comment-input')).toHaveValue('моё')
    fireEvent.click(screen.getByTestId('review-rewrite-apply'))
    expect(screen.getByTestId('review-comment-input')).toHaveValue('Новый текст по таблице')
  })

  it('выключенная форма (§198) показывает причину и не даёт решить', () => {
    bar({ disabledReason: 'Ученик уже начал новую попытку' })
    expect(screen.getByTestId('review-blocked-reason')).toHaveTextContent('новую попытку')
    expect(screen.getByTestId('review-accept-button')).toBeDisabled()
    expect(screen.getByTestId('review-return-button')).toBeDisabled()
    expect(screen.queryByTestId('review-rewrite-button')).not.toBeInTheDocument()
  })
})
