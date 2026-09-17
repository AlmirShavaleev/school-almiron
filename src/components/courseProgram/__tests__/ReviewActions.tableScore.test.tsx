import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * §199. Балл из таблицы проверки в форме вердикта.
 *
 * Правило одно и оно важное: подставляем, пока преподаватель не вписал своё
 * число. Как только вписал — не спорим, а говорим, что получается по таблице,
 * и предлагаем взять.
 */

const attempt = {
  id: 'a1',
  homework_id: 'h1',
  student_id: 's1',
  attempt_number: 1,
  status: 'submitted',
  submitted_at: '2026-09-17T09:00:00Z',
  created_at: '2026-09-17T08:00:00Z',
  updated_at: '2026-09-17T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

function form(tableScore: number | null) {
  const onReview = vi.fn(async () => {})
  const view = render(
    <ReviewActions attempt={attempt} gradeScale="five" onReview={onReview} tableScore={tableScore} />,
  )
  return { ...view, onReview }
}

const scoreInput = () => screen.getByTestId('review-score-input') as HTMLInputElement

describe('ReviewActions — балл по таблице', () => {
  it('нетронутое поле балла заполняется из таблицы', () => {
    form(4)
    expect(scoreInput().value).toBe('4')
    // Спорить не о чем — подсказки нет.
    expect(screen.queryByTestId('review-score-from-table')).not.toBeInTheDocument()
  })

  it('таблица пересчиталась — поле едет за ней, пока его не трогали', () => {
    const { rerender } = form(4)
    rerender(<ReviewActions attempt={attempt} gradeScale="five" onReview={async () => {}} tableScore={3} />)
    expect(scoreInput().value).toBe('3')
  })

  it('своё число не подменяется: рядом появляется «по таблице получается N»', () => {
    form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    expect(scoreInput().value).toBe('5')
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('По таблице получается 4')
  })

  it('после правки руками таблица поле больше не трогает', () => {
    const { rerender } = form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    rerender(<ReviewActions attempt={attempt} gradeScale="five" onReview={async () => {}} tableScore={3} />)
    expect(scoreInput().value).toBe('5')
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('По таблице получается 3')
  })

  it('«Взять из таблицы» подставляет балл и возвращает подстановку', () => {
    const { rerender } = form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('review-score-take-table'))
    expect(scoreInput().value).toBe('4')
    expect(screen.queryByTestId('review-score-from-table')).not.toBeInTheDocument()
    // И дальше поле снова едет за таблицей.
    rerender(<ReviewActions attempt={attempt} gradeScale="five" onReview={async () => {}} tableScore={2} />)
    expect(scoreInput().value).toBe('2')
  })

  it('балла по таблице нет — форма ведёт себя как прежде', () => {
    form(null)
    expect(scoreInput().value).toBe('')
    expect(screen.queryByTestId('review-score-from-table')).not.toBeInTheDocument()
  })

  it('подставленный балл уходит в вердикт', async () => {
    const { onReview } = form(4)
    fireEvent.click(screen.getByTestId('review-accept-button'))
    await vi.waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', '', 4))
  })
})
