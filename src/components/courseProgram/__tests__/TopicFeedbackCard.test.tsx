import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Опрос по уроку (письмо 16.10): шаги нажатиями, сохранение, свёрнутая строка «Спасибо · Изменить».
const calls = vi.hoisted(() => ({ list: [] as Array<{ fn: string; args: Record<string, unknown> }>, mine: null as unknown }))
vi.mock('@/lib/safeRpc', () => ({
  safeRpc: async (fn: string, args: Record<string, unknown>) => {
    calls.list.push({ fn, args })
    if (fn === 'my_topic_feedback') return { data: calls.mine, error: null }
    if (fn === 'save_topic_feedback') return { data: { updated_at: 'x' }, error: null }
    return { data: null, error: null }
  },
}))

import { TopicFeedbackCard } from '@/components/courseProgram/TopicFeedbackCard'

beforeEach(() => { calls.list = []; calls.mine = null })

describe('TopicFeedbackCard', () => {
  it('не пройден — карточка «Опрос по уроку · 30 секунд», 5 шагов, отправка сохраняет ответы и сворачивает', async () => {
    render(<TopicFeedbackCard topicId="t1" preview={false} />)
    expect(await screen.findByText('Опрос по уроку · 30 секунд')).toBeInTheDocument()
    expect(screen.getByTestId('topic-feedback-step')).toHaveTextContent('1 из 5')

    fireEvent.click(within(screen.getByRole('group', { name: 'Понятность' })).getByRole('button', { name: 'Частично' }))
    fireEvent.click(screen.getByRole('button', { name: 'Посмотрел целиком' }))
    fireEvent.click(screen.getByRole('button', { name: 'Быстро' }))
    fireEvent.click(screen.getByTestId('topic-feedback-next'))

    fireEvent.click(screen.getByRole('button', { name: 'Слишком сложные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Меньше половины' }))
    fireEvent.click(screen.getByTestId('topic-feedback-next'))

    fireEvent.click(screen.getByRole('button', { name: 'Задача ДЗ №' }))
    fireEvent.change(screen.getByTestId('topic-feedback-hw-task'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('topic-feedback-next'))

    fireEvent.click(screen.getByRole('button', { name: 'Да' }))
    fireEvent.click(screen.getByRole('button', { name: 'Решения' }))
    fireEvent.change(screen.getByTestId('topic-feedback-error-text'), { target: { value: 'знак' } })
    fireEvent.click(screen.getByRole('button', { name: '1–2 ч' }))
    fireEvent.click(screen.getByTestId('topic-feedback-next'))

    fireEvent.change(screen.getByTestId('topic-feedback-improve'), { target: { value: 'больше рисунков' } })
    fireEvent.click(screen.getByTestId('topic-feedback-submit'))

    expect(await screen.findByText('Спасибо, ответы сохранены')).toBeInTheDocument()
    const save = calls.list.find(c => c.fn === 'save_topic_feedback')!
    expect(save.args.p_topic_id).toBe('t1')
    expect(save.args.p_answers).toMatchObject({
      clarity: 'partly', video: 'full', video_pace: 'fast', lesson_difficulty: 'hard', hw_self: 'few',
      hard_spots: ['hw_task'], hard_hw_task: '5', found_error: true, error_where: 'solutions', error_text: 'знак',
      time_spent: '1_2h', improve: 'больше рисунков',
    })
  })

  it('ничего не обязательно: можно сразу пролистать и отправить', async () => {
    render(<TopicFeedbackCard topicId="t1" preview={false} />)
    await screen.findByText('Опрос по уроку · 30 секунд')
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('topic-feedback-next'))
    fireEvent.click(screen.getByTestId('topic-feedback-submit'))
    await waitFor(() => expect(calls.list.some(c => c.fn === 'save_topic_feedback')).toBe(true))
  })

  it('уже пройден — одна строка и «Изменить» открывает опрос с прежними ответами', async () => {
    calls.mine = { clarity: 'mostly', hard_spots: [] }
    render(<TopicFeedbackCard topicId="t1" preview={false} />)
    expect(await screen.findByText('Опрос по уроку пройден')).toBeInTheDocument()
    expect(screen.queryByText('Опрос по уроку · 30 секунд')).toBeNull()
    fireEvent.click(screen.getByTestId('topic-feedback-edit'))
    expect(screen.getByRole('button', { name: 'В основном' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('предпросмотр: видна, выключена, запросов нет', async () => {
    render(<TopicFeedbackCard topicId="t1" preview />)
    expect(screen.getByTestId('topic-feedback-preview')).toHaveTextContent('В предпросмотре опрос не проходят')
    expect(screen.getByRole('button', { name: 'Полностью' })).toBeDisabled()
    expect(calls.list).toHaveLength(0)
  })
})
