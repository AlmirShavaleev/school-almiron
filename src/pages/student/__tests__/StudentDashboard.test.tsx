import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Главная ученика «без шума» (письмо главная_ученика_без_шума.md, 14.10).
 *
 * Хуки страницы настоящие, подменён только Supabase — «записывающим»
 * клиентом: так проверяется и картинка, и то, КАКИЕ запросы главная делает.
 * Ушедшие блоки (что сдать, задача дня, цель недели, прогноз, серия, баллы,
 * достижения, календарь, план недели) не должны вернуться ни на экран, ни в
 * сеть.
 */

const calls: string[] = []
const RPC: Record<string, unknown> = {
  my_mock_exams: [],
  student_home_courses: [
    {
      course_id: 'c1', topics_total: 10, topics_done: 4,
      modules: [
        { module_id: 'm1', title: 'Кинематика', order_index: 1, total: 5, done: 4 },
        { module_id: 'm2', title: 'Динамика', order_index: 2, total: 5, done: 0 },
      ],
      continue: { topic_id: 't6', title: 'Второй закон Ньютона', module_title: 'Динамика' },
    },
  ],
}
const TABLES: Record<string, unknown> = {
  students: { id: 'st-1' },
  group_students: [
    { group_id: 'g1', groups: { id: 'g1', course_id: 'c1', courses: { id: 'c1', title: 'Физика ЕГЭ', subject: 'physics', exam_type: 'ege' } } },
  ],
}

function builder(table: string) {
  const res = Promise.resolve({ data: TABLES[table] ?? null, error: null })
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single']) b[m] = () => b
  b.then = res.then.bind(res)
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => { calls.push(`from:${table}`); return builder(table) },
    rpc: (fn: string) => { calls.push(`rpc:${fn}`); return Promise.resolve({ data: RPC[fn] ?? null, error: null }) },
  },
}))
vi.mock('@/store/authStore', () => {
  const state = { profile: { id: 'profile-1', full_name: 'Шавалеев Альмир', role: 'student' } }
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) }
})

import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { useVisibleObserver } from '@/test/visibleObserver'

useVisibleObserver()

async function renderHome() {
  render(<MemoryRouter initialEntries={['/dashboard']}><StudentDashboard /></MemoryRouter>)
  await screen.findByTestId('student-home')
  await screen.findByTestId('hero-continue')
}

beforeEach(() => { calls.length = 0 })

describe('главная ученика без шума', () => {
  it('шапка: привет, дата и «дней до ЕГЭ» без серии', async () => {
    await renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Привет, Альмир')
    expect(screen.getByTestId('exam-countdown')).toHaveTextContent('до ЕГЭ')
    expect(screen.queryByText(/серия/i)).toBeNull()
  })

  it('«Продолжить урок» — одна кнопка в шапке, крупной карточки с лентой шагов нет', async () => {
    await renderHome()
    expect(screen.getByTestId('hero-continue')).toHaveAttribute('href', '/my-course/g1/topic/t6')
    expect(screen.queryByTestId('continue-lesson')).toBeNull()
    expect(screen.queryByRole('link', { name: 'К уроку →' })).toBeNull()
  })

  it('карточка курса: общий % и полоски по разделам, «Продолжить» — в тему', async () => {
    await renderHome()
    const course = screen.getByTestId('home-course')
    expect(within(course).getByTestId('course-percent')).toHaveTextContent('40%')
    expect(within(course).getAllByTestId('home-module').map(m => m.textContent)).toEqual(['Кинематика80%', 'Динамика0%'])
    expect(within(course).getByRole('link', { name: 'Продолжить' })).toHaveAttribute('href', '/my-course/g1/topic/t6')
  })

  it('снятые блоки не вернулись; запросы — прежние плюс посещения (этап 2 ЛК); календаря тем на главной нет', async () => {
    await renderHome()
    for (const text of [/Задача дня/, /Цель недели/, /Баллы школы/, /Примерный балл/, /Решено задач/, /Вернули на доработку/]) {
      expect(screen.queryByText(text)).toBeNull()
    }
    await waitFor(() => expect(calls).toContain('rpc:student_home_activity'))
    expect(screen.queryByTestId('home-calendar')).toBeNull()
    // Цели (письмо 16.10, решение владельца): цель на экзамен и цели недели — два запроса.
    await waitFor(() => expect(calls).toContain('rpc:my_weekly_goals'))
    expect([...new Set(calls)].sort()).toEqual([
      'from:group_students', 'from:student_exam_goals', 'from:students',
      'rpc:my_mock_exams', 'rpc:my_weekly_goals', 'rpc:student_home_activity', 'rpc:student_home_courses',
    ])
  })

  it('посещения по дням: карта 12 недель, «дней подряд» и рекорд', async () => {
    RPC.student_home_activity = { today: '2026-10-15', streak: 3, record: 9, visits: ['2026-10-13', '2026-10-14', '2026-10-15'], solved: [{ day: '2026-10-14', n: 6 }] }
    await renderHome()
    const card = await screen.findByTestId('home-activity')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('3 дня подряд · рекорд 9')
    expect(card.querySelectorAll('.stu-heat-col')).toHaveLength(12)
    const cell = card.querySelector('[data-day="2026-10-14"]')!
    expect(cell).toHaveClass('lv-3')
    // Наведение — подсказка с днём сразу (не системный title); сегодня обведено.
    fireEvent.mouseEnter(cell)
    expect(screen.getByTestId('activity-tip')).toHaveTextContent('среда, 14 октября: 6 задач')
    fireEvent.mouseLeave(cell)
    expect(screen.queryByTestId('activity-tip')).toBeNull()
    expect(card.querySelector('[data-day="2026-10-15"]')).toHaveClass('is-today')
    expect(card.querySelector('[data-day="2026-10-15"]')).toHaveAttribute('aria-label', 'сегодня, четверг, 15 октября: заходил, задач не решал')
    delete RPC.student_home_activity
  })
})
