import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress, TopicProgress } from '@/hooks/useStudentCourseProgram'
import type { TopicSection } from '@/lib/topicMaterialItems'

/**
 * Уроки раздела — простыми плитками (макет страницы курса v2, решение
 * владельца 15.10; заменили строки §182 и карточки §274). На плитке: «Урок N»,
 * название и одна пилюля состояния. Открытый урок — ссылка в урок, закрытый —
 * без перехода, с условием открытия. Проверяется то, что видит ученик.
 */

const topic = (id: string, over: Partial<TopicProgress> = {}): TopicProgress => ({
  id, title: `Тема ${id}`, order_index: 1, max_score: 100,
  available_from: null, is_open: true, sections: new Set<TopicSection>(),
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null,
  tasks_total: 0, tasks_closed: 0,
  completed_count: 0, assignment_count: 0,
  ...over,
})

const sections = (...keys: TopicSection[]) => new Set<TopicSection>(keys)

let topics: TopicProgress[] = []

const modules = (): ModuleProgress[] => [{
  id: 'm1', title: 'Механика', order_index: 1, topics,
  done: 0, total: 0,
  counters: countTopics(topics.map(t => ({
    is_open: t.is_open, available_from: t.available_from,
    hasHomework: !!t.hw_id, hwStatus: t.hw_status,
  }))),
}]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: {
      id: 'c1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege',
      group_name: '11А', teacher: null, curator: null,
    },
    modules: modules(),
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('@/hooks/useStudentWeekPlan', () => ({
  useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'p1', role: 'student' } }),
}))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

/** Курс открывается на плитках разделов — в раздел надо зайти. */
async function openModule() {
  render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByText('Механика'))
  return screen.findAllByTestId('lesson-tile')
}

const pill = (tile: HTMLElement) => within(tile).getByTestId('lesson-tile-pill')

beforeEach(() => {
  topics = []
})

describe('плитки уроков в разделе', () => {
  it('номер, название и ссылка в урок', async () => {
    topics = [topic('t1'), topic('t2', { hw_id: 'hw2', hw_status: 'not_started' })]
    const tiles = await openModule()
    expect(tiles).toHaveLength(2)
    expect(tiles[1]).toHaveTextContent('Урок 2')
    expect(tiles[1]).toHaveTextContent('Тема t2')
    expect(within(tiles[1]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/topic/t2')
  })

  it('несданное ДЗ — «сдать ДЗ», вернули — «вернули · сдать ДЗ»', async () => {
    topics = [
      topic('t1', { hw_id: 'hw1', hw_status: 'not_started' }),
      topic('t2', { hw_id: 'hw2', hw_status: 'returned' }),
    ]
    const [a, b] = await openModule()
    expect(a).toHaveAttribute('data-state', 'hw')
    expect(pill(a)).toHaveTextContent('сдать ДЗ')
    expect(pill(b)).toHaveTextContent('вернули · сдать ДЗ')
  })

  it('срок прошёл — «просрочено»', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'not_started', hw_due_at: '2020-01-01T00:00:00Z' })]
    const [a] = await openModule()
    expect(a).toHaveAttribute('data-overdue')
    expect(pill(a)).toHaveTextContent('просрочено')
  })

  it('на проверке, пройдено (ДЗ принято), без ДЗ', async () => {
    topics = [
      topic('t1', { hw_id: 'hw1', hw_status: 'submitted' }),
      topic('t2', { hw_id: 'hw2', hw_status: 'accepted', hw_score: 18, hw_max: 20 }),
      topic('t3'),
    ]
    const [a, b, c] = await openModule()
    expect(pill(a)).toHaveTextContent('на проверке')
    expect(b).toHaveAttribute('data-state', 'done')
    expect(pill(b)).toHaveTextContent('пройдено')
    expect(pill(c)).toHaveTextContent('без ДЗ')
  })

  it('закрытый урок — не ссылка, условие открытия на плитке', async () => {
    topics = [topic('t1', { is_open: false, sections: sections('video', 'theory'), hw_id: 'hw1', hw_status: 'not_started' })]
    const [a] = await openModule()
    expect(a).toHaveAttribute('data-state', 'locked')
    expect(within(a).queryByRole('link')).toBeNull()
    expect(pill(a)).toHaveTextContent(/Откроется|Закрыт/)
  })

  it('переключателя «Список/Карточки» у раздела уроков нет', async () => {
    topics = [topic('t1')]
    await openModule()
    expect(screen.queryByTestId('view-toggle-cards')).toBeNull()
  })
})
