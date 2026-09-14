import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { TopicTaskRow } from '@/hooks/useTopicTasks'

/**
 * §175. Вкладка «Задачи» на странице темы: одна задача на экране, лента шагов,
 * текущая — в адресе. Здесь проверяется связка страница + лента: `?task=` в
 * адресе страницы восстанавливает задачу, а счёт в шапке группы и в ленте —
 * один и тот же (хук один, поднят на страницу — §162).
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

function chain(result: unknown, count = 0) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'topics') return chain({
        id: TOPIC, title: 'Кинематика', order_index: 0, available_from: null,
        modules: { id: 'mod-1', title: 'Механика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      return chain(null, 0)
    },
  },
}))

// Профиль — один объект на весь тест: новый объект на каждый рендер перезапускал
// бы загрузку страницы после каждой смены адреса (`?task=`).
const PROFILE = { id: 'u1', role: 'student' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: PROFILE }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [], loading: false, error: null }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: false, unlocked: false, loading: false }),
}))
vi.mock('@/hooks/useTopicSectionMarks', () => ({
  useTopicSectionMarks: () => ({ marks: new Set(), canMark: false, loading: false, toggle: vi.fn() }),
}))
vi.mock('@/hooks/useMyTopicHomeworkState', () => ({
  useMyTopicHomeworkState: () => ({ state: 'none' }),
  TOPIC_HOMEWORK_STATE_LABEL: { none: 'не выдано' },
}))
// Привязанный вариант есть — иначе вкладки «Задачи» не будет вовсе.
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [{ student_assignment_id: 'sa-1' }] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))
vi.mock('@/components/catalog/CatalogTaskContent', () => ({
  CatalogTaskContent: ({ task }: { task: { statement_html: string } }) => (
    <div data-testid="statement">{task.statement_html}</div>
  ),
}))

function row(n: number, patch: Partial<TopicTaskRow> = {}): TopicTaskRow {
  return {
    student_assignment_id: 'sa-1', item_id: `item-${n}`, item_position: n, task_id: `task-${n}`,
    statement_html: `Условие ${n}`, assets: [], max_points: 1, auto_checkable: true,
    answer_raw: null, is_correct: null, attempts_count: 0, closed_by: null,
    solution_shown_at: null, solution_html: null, answer_html: null, ...patch,
  }
}

const rows: TopicTaskRow[] = [
  row(1, { closed_by: 'auto', attempts_count: 1 }),
  row(2),
  row(3),
]

vi.mock('@/hooks/useTopicTasks', () => ({
  useTopicTasks: () => ({
    rows, total: rows.length, solved: rows.filter(r => r.closed_by !== null).length,
    loading: false, error: null, busyItem: null,
    answer: vi.fn(async () => true), reveal: vi.fn(async () => null), closeSelf: vi.fn(async () => {}), reload: vi.fn(),
  }),
}))

import { TopicPage } from '@/pages/TopicPage'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}${search}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<><TopicPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openTasks() {
  fireEvent.click(await screen.findByRole('tab', { name: /Задачи/ }))
}

describe('Страница темы — задачи к уроку (§175)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('одна карточка, первая нерешённая, адрес получает `?task=`', async () => {
    renderPage()
    await openTasks()

    expect(screen.getAllByTestId('statement')).toHaveLength(1)
    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 2')
    expect(screen.getByTestId('location')).toHaveTextContent(`/topic/${TOPIC}?task=item-2`)
  })

  it('`?task=` в адресе страницы восстанавливает задачу после обновления', async () => {
    renderPage('?task=item-3')
    await openTasks()

    expect(screen.getByTestId('statement')).toHaveTextContent('Условие 3')
    const strip = screen.getByTestId('topic-tasks-strip')
    expect(within(strip).getByRole('button', { name: /Задача 3/ })).toHaveAttribute('aria-current', 'step')
  })

  it('счёт в шапке группы и в ленте — одно число', async () => {
    renderPage()
    await openTasks()

    expect(screen.getByTestId('topic-group-tasks-state')).toHaveTextContent('решено 1 из 3')
    expect(screen.getByText(/Решено 1 из 3/)).toBeInTheDocument()
    const squares = within(screen.getByTestId('topic-tasks-strip')).getAllByRole('button')
    expect(squares.filter(b => b.getAttribute('data-state') === 'solved')).toHaveLength(1)
  })
})
