import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §271. «Оценки уроков» у персонала: по умолчанию сверху самые низкие,
 * среднее ниже 7 — «переработать», неоценённые уроки — внизу; «По порядку
 * курса» возвращает порядок программы; клик по уроку раскрывает
 * распределение 1..10. Сводку отдаёт `topic_ratings_summary`.
 */
const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args)
      if (name === 'topic_ratings_summary') {
        return Promise.resolve({
          data: [
            // T1: 8,5 — хорошо; T2: 5,0 — переработать; T4: 6,96 → «7,0», не переработать.
            { topic_id: 'T1', ratings: 2, avg_rating: 8.5, dist: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0], last_at: '2026-10-07T10:00:00Z' },
            { topic_id: 'T2', ratings: 3, avg_rating: 5, dist: [0, 0, 1, 0, 1, 0, 1, 0, 0, 0], last_at: '2026-10-08T10:00:00Z' },
            { topic_id: 'T4', ratings: 25, avg_rating: 6.96, dist: [0, 0, 0, 0, 0, 1, 24, 0, 0, 0], last_at: '2026-10-06T10:00:00Z' },
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

const loadModules = vi.fn()
vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: [
      { id: 'TPL', title: 'Каркас физики', is_template: true },
      { id: 'C1', title: 'Физика 11А', is_template: false },
    ],
    loading: false,
    loadModules,
  }),
}))

import { TopicRatingsPage } from '@/pages/TopicRatingsPage'

beforeEach(() => {
  rpc.mockClear()
  loadModules.mockReset()
  loadModules.mockResolvedValue([
    { id: 'M1', course_id: 'C1', title: 'Механика', order_index: 0, topics: [
      { id: 'T1', title: 'Кинематика' }, { id: 'T2', title: 'Динамика' }, { id: 'T3', title: 'Статика' },
    ] },
    { id: 'M2', course_id: 'C1', title: 'Оптика', order_index: 1, topics: [
      { id: 'T4', title: 'Линзы' }, { id: 'T5', title: 'Зеркала' },
    ] },
  ])
})

function titles() {
  return screen.getAllByTestId('topic-ratings-row').map(r => r.getAttribute('data-topic-id'))
}

describe('TopicRatingsPage (§271)', () => {
  it('по умолчанию — каркас (§276: все группы вместе), сверху самые низкие, неоценённые внизу', async () => {
    render(<MemoryRouter><TopicRatingsPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('topic-ratings-row')).toHaveLength(5))
    expect(loadModules).toHaveBeenCalledWith('TPL')
    expect(rpc).toHaveBeenCalledWith('topic_ratings_summary', { p_course_id: 'TPL' })
    expect(screen.getByTestId('topic-ratings-scope')).toHaveTextContent('оценки всех групп')
    expect(titles()).toEqual(['T2', 'T4', 'T1', 'T3', 'T5'])
    expect(screen.getByTestId('topic-ratings-stats')).toHaveTextContent('Оценено 3 из 5 уроков')
  })

  it('среднее ниже 7 — «переработать»; 6,96 показано как 7,0 и не помечено', async () => {
    render(<MemoryRouter><TopicRatingsPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('topic-ratings-row')).toHaveLength(5))
    const [t2, t4, t1, t3] = screen.getAllByTestId('topic-ratings-row')
    expect(t2).toHaveAttribute('data-rework', 'true')
    expect(within(t2).getByTestId('topic-ratings-avg')).toHaveTextContent('5,0')
    expect(within(t2).getByTestId('topic-ratings-rework')).toHaveTextContent('переработать')
    expect(within(t4).getByTestId('topic-ratings-avg')).toHaveTextContent('7,0')
    expect(within(t4).queryByTestId('topic-ratings-rework')).toBeNull()
    expect(within(t1).getByTestId('topic-ratings-avg')).toHaveTextContent('8,5')
    expect(t3).toHaveTextContent('нет оценок')
    expect(t3).not.toHaveAttribute('data-rework')
  })

  it('«По порядку курса» — порядок программы', async () => {
    render(<MemoryRouter><TopicRatingsPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('topic-ratings-row')).toHaveLength(5))
    fireEvent.click(screen.getByTestId('topic-ratings-sort-course'))
    expect(titles()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])
  })

  it('клик по уроку раскрывает распределение 1..10', async () => {
    render(<MemoryRouter><TopicRatingsPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('topic-ratings-row')).toHaveLength(5))
    fireEvent.click(screen.getByRole('button', { name: /Динамика/ }))
    const dist = screen.getByTestId('topic-ratings-dist')
    expect(within(dist).getAllByRole('listitem')).toHaveLength(10)
    expect(dist).toHaveTextContent('3 звезды1')
    expect(dist).toHaveTextContent('10 звёзд0')
  })

  it('выбор курса в списке перезагружает сводку', async () => {
    render(<MemoryRouter><TopicRatingsPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('topic-ratings-row')).toHaveLength(5))
    fireEvent.change(screen.getByTestId('topic-ratings-course'), { target: { value: 'C1' } })
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('topic_ratings_summary', { p_course_id: 'C1' }))
    expect(loadModules).toHaveBeenCalledWith('C1')
    await waitFor(() => expect(screen.getByTestId('topic-ratings-scope')).toHaveTextContent('только оценки этой группы'))
  })
})
