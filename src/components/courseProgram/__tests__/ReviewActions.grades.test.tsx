import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

vi.mock('@/lib/rewriteComment', () => ({ rewriteCommentByTable: vi.fn() }))

/**
 * §265. 5-балльная работа (проверочная, контрольная или урок, где учитель
 * выбрал 5-балльную) — оценка ставится кнопками 2 · 3 · 4 · 5 вместо поля.
 * Ноля и единицы нет ни в одной раскладке; оценка из таблицы нажимает свою
 * кнопку, пока учитель не выбрал сам.
 */

const attempt = {
  id: 'a1', homework_id: 'h1', student_id: 's1', attempt_number: 1, status: 'submitted',
  submitted_at: '2026-10-04T09:00:00Z', created_at: '2026-10-04T08:00:00Z', updated_at: '2026-10-04T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

const LAYOUTS = ['calm', 'bar', 'form'] as const

function five(layout: (typeof LAYOUTS)[number], over: Partial<React.ComponentProps<typeof ReviewActions>> = {}) {
  const onReview = vi.fn(async () => {})
  const props = { layout, attempt, gradeScale: 'five' as const, onReview, ...over }
  const view = render(<ReviewActions {...props} />)
  return { onReview, rerender: (next: Partial<typeof props>) => view.rerender(<ReviewActions {...props} {...next} />) }
}

const pressed = () => screen.queryAllByRole('button', { pressed: true }).map(b => b.textContent)

describe.each(LAYOUTS)('оценка кнопками 2–5 — раскладка %s', layout => {
  it('кнопки ровно 2, 3, 4, 5; поля с числом нет; без оценки «Принять» выключено', () => {
    five(layout)
    const group = screen.getByRole('group', { name: 'Оценка' })
    expect(Array.from(group.querySelectorAll('button')).map(b => b.textContent)).toEqual(['2', '3', '4', '5'])
    expect(screen.queryByTestId('review-score-input')).not.toBeInTheDocument()
    expect(pressed()).toEqual([])
    expect(screen.getByTestId('review-accept-button')).toBeDisabled()
  })

  it('нажали «3» — она одна нажата, «Принять» уносит 3', async () => {
    const { onReview } = five(layout)
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 3' }))
    expect(pressed()).toEqual(['3'])
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 5' }))
    expect(pressed()).toEqual(['5'])
    fireEvent.click(screen.getByTestId('review-accept-button'))
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', '', 5))
  })

  it('оценка из таблицы нажимает свою кнопку, пока учитель не выбрал сам', () => {
    const { rerender } = five(layout, { tableScore: 4 })
    expect(pressed()).toEqual(['4'])
    rerender({ tableScore: 3 })
    expect(pressed()).toEqual(['3'])
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 5' }))
    rerender({ tableScore: 2 })
    expect(pressed()).toEqual(['5'])
  })

  it('подстановка вне 2–5 (например, «1») не нажимает ничего и не даёт принять', () => {
    five(layout, { fillRequest: { score: 1 } })
    expect(pressed()).toEqual([])
    expect(screen.getByTestId('review-accept-button')).toBeDisabled()
    expect(screen.getByTestId('review-score-error')).toHaveTextContent('Выберите оценку: 2, 3, 4 или 5')
  })

  it('выключенная форма (§198) — кнопки оценок тоже выключены', () => {
    five(layout, { disabledReason: 'Ученик уже сдал заново' })
    for (const g of ['2', '3', '4', '5']) expect(screen.getByRole('button', { name: `Оценка ${g}` })).toBeDisabled()
  })
})
