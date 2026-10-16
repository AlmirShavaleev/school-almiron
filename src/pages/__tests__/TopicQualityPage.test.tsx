import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// «Качество уроков» (письмо 16.10): худшие темы сверху, ошибки со ссылкой на ученика, CSV для методиста.
vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: [{ id: 'c1', title: 'Физика ЕГЭ', is_template: true }],
    loading: false,
    loadModules: async () => [{ id: 'm1', title: 'Кинематика', topics: [
      { id: 't1', title: 'Скорость' }, { id: 't2', title: 'Ускорение' },
    ] }],
  }),
}))
vi.mock('@/lib/safeRpc', () => ({
  safeRpc: async (fn: string) => {
    if (fn === 'topic_feedback_for_course') return { data: [
      { topic_id: 't1', student_id: 's1', student_name: 'Аня', clarity: 'full', hw_self: 'all', hard_spots: ['nothing'], updated_at: '2026-10-16T10:00:00Z' },
      { topic_id: 't2', student_id: 's2', student_name: 'Петя', clarity: 'no', hw_self: 'none', lesson_difficulty: 'hard',
        hard_spots: ['hw_task'], hard_hw_task: '5', found_error: true, error_where: 'tasks', error_task: '5', error_text: 'опечатка в условии',
        improve: 'больше примеров', updated_at: '2026-10-16T11:00:00Z' },
    ], error: null }
    if (fn === 'topic_ratings_summary') return { data: [{ topic_id: 't2', ratings: 1, avg_rating: 4, dist: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0], last_at: null }], error: null }
    return { data: null, error: null }
  },
}))

import { TopicQualityPage } from '@/pages/TopicQualityPage'

describe('TopicQualityPage', () => {
  it('худшая тема сверху; «где трудно» с номером; ошибка — со ссылкой на ученика', async () => {
    render(<MemoryRouter><TopicQualityPage /></MemoryRouter>)
    const rows = await screen.findAllByTestId('topic-quality-row')
    expect(rows.map(r => r.getAttribute('data-topic-id'))).toEqual(['t2', 't1'])
    expect(within(rows[0]).getByTestId('topic-quality-unclear')).toHaveTextContent('100 %')
    expect(within(rows[0]).getByTestId('topic-quality-hwlow')).toHaveTextContent('100 %')
    expect(within(rows[0]).getByTestId('topic-quality-hard')).toHaveTextContent('Задача ДЗ № 5 (1)')
    expect(screen.getByTestId('topic-quality-stats')).toHaveTextContent('2 ответа · опрос прошли по 2 из 2 уроков')

    fireEvent.click(within(rows[0]).getByRole('button', { name: /Ускорение/ }))
    const details = screen.getByTestId('topic-quality-details')
    expect(details).toHaveTextContent('Задачи, № 5 — опечатка в условии')
    expect(within(details).getByRole('link', { name: 'Петя' })).toHaveAttribute('href', '/students/s2')
    expect(details).toHaveTextContent('«больше примеров»')
  })

  it('CSV выгружается файлом', async () => {
    const create = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    render(<MemoryRouter><TopicQualityPage /></MemoryRouter>)
    await screen.findAllByTestId('topic-quality-row')
    fireEvent.click(screen.getByTestId('topic-quality-csv'))
    expect(create).toHaveBeenCalledTimes(1)
  })
})
