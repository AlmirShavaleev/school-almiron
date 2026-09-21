import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * §199 + §212. Балл из таблицы проверки в форме вердикта.
 *
 * Правило одно и оно важное: подставляем, пока преподаватель не вписал своё
 * число. Как только вписал — не спорим, а просто держим рядом справку
 * «рекомендуемый балл N». Кнопки «Взять из таблицы» с §212 нет: поле и так
 * заполнено рекомендацией, пока его не тронули руками, а если тронули —
 * человек уже решил.
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
  it('нетронутое поле балла заполняется из таблицы, рядом — рекомендация', () => {
    form(4)
    expect(scoreInput().value).toBe('4')
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('рекомендуемый балл 4')
  })

  it('таблица пересчиталась — поле едет за ней, пока его не трогали', () => {
    const { rerender } = form(4)
    rerender(<ReviewActions attempt={attempt} gradeScale="five" onReview={async () => {}} tableScore={3} />)
    expect(scoreInput().value).toBe('3')
  })

  it('своё число не подменяется, а рекомендация остаётся рядом', () => {
    form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    expect(scoreInput().value).toBe('5')
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('рекомендуемый балл 4')
  })

  it('после правки руками таблица поле больше не трогает', () => {
    const { rerender } = form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    rerender(<ReviewActions attempt={attempt} gradeScale="five" onReview={async () => {}} tableScore={3} />)
    expect(scoreInput().value).toBe('5')
    expect(screen.getByTestId('review-score-from-table')).toHaveTextContent('рекомендуемый балл 3')
  })

  it('§212. Кнопки «Взять из таблицы» больше нет', () => {
    form(4)
    fireEvent.change(scoreInput(), { target: { value: '5' } })
    expect(screen.queryByTestId('review-score-take-table')).not.toBeInTheDocument()
  })

  it('§212. «Принять» и «Вернуть на доработку» стоят в одной строке', () => {
    form(4)
    const decisions = screen.getByTestId('review-decision-row')
    expect(decisions).toContainElement(screen.getByTestId('review-accept-button'))
    expect(decisions).toContainElement(screen.getByTestId('review-return-button'))
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
