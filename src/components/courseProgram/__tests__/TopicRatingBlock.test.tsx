import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §271. «Оцените урок» внизу темы: 10 звёзд, клик зовёт `rate_topic` с
 * номером звезды, после сохранения — «Спасибо!» и своя оценка; повторный клик
 * меняет оценку. В предпросмотре звёзды выключены и ни одного запроса нет.
 */
const rpc = vi.fn()
let myRating: number | null = null
let failRate = false

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args)
      if (name === 'my_topic_rating') return Promise.resolve({ data: myRating, error: null })
      if (name === 'rate_topic') {
        if (failRate) return Promise.resolve({ data: null, error: { message: 'Нет доступа к этому уроку', code: '42501' } })
        return Promise.resolve({ data: { rating: args.p_rating, updated_at: '2026-10-08T10:00:00Z' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

import { TopicRatingBlock } from '@/components/courseProgram/TopicRatingBlock'

const TOPIC = 't0000000-0000-0000-0000-000000000001'

beforeEach(() => {
  rpc.mockClear()
  myRating = null
  failRate = false
})

describe('TopicRatingBlock — оценка урока учеником (§271)', () => {
  it('10 звёзд с подписями «Оценка N из 10»', async () => {
    render(<TopicRatingBlock topicId={TOPIC} preview={false} />)
    expect(screen.getByText('Оцените урок')).toBeInTheDocument()
    const stars = screen.getAllByRole('button', { name: /^Оценка \d+ из 10$/ })
    expect(stars).toHaveLength(10)
    expect(stars[0]).toHaveAccessibleName('Оценка 1 из 10')
    expect(stars[9]).toHaveAccessibleName('Оценка 10 из 10')
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('my_topic_rating', { p_topic_id: TOPIC }))
  })

  it('клик по 8-й звезде зовёт rate_topic(8) и показывает «Спасибо!»', async () => {
    render(<TopicRatingBlock topicId={TOPIC} preview={false} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Оценка 8 из 10' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 8 из 10' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rate_topic', { p_topic_id: TOPIC, p_rating: 8 }))
    expect(await screen.findByTestId('topic-rating-saved')).toHaveTextContent('Спасибо! Ваша оценка: 8 из 10')
    expect(screen.getByRole('button', { name: 'Оценка 8 из 10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Оценка 7 из 10' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('своя прежняя оценка видна сразу, её можно изменить', async () => {
    myRating = 4
    render(<TopicRatingBlock topicId={TOPIC} preview={false} />)
    expect(await screen.findByTestId('topic-rating-current')).toHaveTextContent('Ваша оценка: 4 из 10')
    expect(screen.getByRole('button', { name: 'Оценка 4 из 10' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 10 из 10' }))
    expect(await screen.findByTestId('topic-rating-saved')).toHaveTextContent('Ваша оценка: 10 из 10')
    expect(rpc).toHaveBeenCalledWith('rate_topic', { p_topic_id: TOPIC, p_rating: 10 })
  })

  it('сбой сохранения — ошибка и прежняя оценка', async () => {
    myRating = 5
    failRate = true
    render(<TopicRatingBlock topicId={TOPIC} preview={false} />)
    await screen.findByTestId('topic-rating-current')
    fireEvent.click(screen.getByRole('button', { name: 'Оценка 2 из 10' }))
    expect(await screen.findByTestId('topic-rating-error')).toHaveTextContent('Не удалось сохранить оценку')
    expect(screen.getByRole('button', { name: 'Оценка 5 из 10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('topic-rating-saved')).toBeNull()
  })

  it('предпросмотр: звёзды выключены, подпись, ни одного запроса', async () => {
    render(<TopicRatingBlock topicId={TOPIC} preview />)
    expect(screen.getByTestId('topic-rating-preview')).toHaveTextContent('В предпросмотре оценку не ставят')
    const stars = screen.getAllByRole('button', { name: /^Оценка \d+ из 10$/ })
    expect(stars).toHaveLength(10)
    for (const s of stars) expect(s).toBeDisabled()
    fireEvent.click(stars[6])
    await new Promise(r => setTimeout(r, 0))
    expect(rpc).not.toHaveBeenCalled()
  })
})
