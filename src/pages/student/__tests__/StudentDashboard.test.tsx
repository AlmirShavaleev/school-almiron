import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  await screen.findByTestId('continue-lesson')
}

beforeEach(() => { calls.length = 0 })

describe('главная ученика без шума', () => {
  it('шапка: привет, дата и «дней до ЕГЭ» без серии', async () => {
    await renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Привет, Альмир')
    expect(screen.getByTestId('exam-countdown')).toHaveTextContent('до ЕГЭ')
    expect(screen.queryByText(/серия/i)).toBeNull()
  })

  it('«Продолжить урок» ведёт в следующую тему', async () => {
    await renderHome()
    const card = screen.getByTestId('continue-lesson')
    expect(within(card).getByRole('link', { name: 'К уроку →' })).toHaveAttribute('href', '/my-course/g1/topic/t6')
    // Та же тема — у главной кнопки первого экрана.
    expect(screen.getByTestId('hero-continue')).toHaveAttribute('href', '/my-course/g1/topic/t6')
    expect(card).toHaveTextContent('Второй закон Ньютона')
    expect(card).toHaveTextContent('Физика ЕГЭ')
  })

  it('карточка курса: общий % и полоски по разделам, «Продолжить» — в тему', async () => {
    await renderHome()
    const course = screen.getByTestId('home-course')
    expect(within(course).getByTestId('course-percent')).toHaveTextContent('40%')
    expect(within(course).getAllByTestId('home-module').map(m => m.textContent)).toEqual(['Кинематика80%', 'Динамика0%'])
    expect(within(course).getByRole('link', { name: 'Продолжить' })).toHaveAttribute('href', '/my-course/g1/topic/t6')
  })

  it('снятые блоки не вернулись; запросы — прежние плюс посещения и календарь тем (этап 2 ЛК)', async () => {
    await renderHome()
    for (const text of [/Задача дня/, /Цель недели/, /Баллы школы/, /Примерный балл/, /Решено задач/, /Вернули на доработку/]) {
      expect(screen.queryByText(text)).toBeNull()
    }
    await waitFor(() => expect(calls).toContain('rpc:student_home_activity'))
    await waitFor(() => expect(calls).toContain('from:topics'))
    expect([...new Set(calls)].sort()).toEqual([
      'from:course_study_plan_items', 'from:course_study_plan_overrides', 'from:course_study_plans',
      'from:group_students', 'from:students', 'from:topics',
      'rpc:my_course_topic_locks', 'rpc:my_mock_exams', 'rpc:student_home_activity', 'rpc:student_home_courses',
    ])
  })

  it('посещения по дням: карта 12 недель, «дней подряд» и рекорд', async () => {
    RPC.student_home_activity = { today: '2026-10-15', streak: 3, record: 9, visits: ['2026-10-13', '2026-10-14', '2026-10-15'], solved: [{ day: '2026-10-14', n: 6 }] }
    await renderHome()
    const card = await screen.findByTestId('home-activity')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('3 дня подряд · рекорд 9')
    expect(card.querySelectorAll('.stu-heat-col')).toHaveLength(12)
    expect(card.querySelector('[title="14 окт: 6 задач"]')).toHaveClass('lv-3')
    delete RPC.student_home_activity
  })

  it('календарь тем курса по расписанию: недели плана, открытая тема — ссылка в урок', async () => {
    TABLES.course_study_plans = [{ course_id: 'c1', start_date: '2026-09-07' }]
    TABLES.course_study_plan_items = [{ course_id: 'c1', topic_id: 't5', week_no: 6 }, { course_id: 'c1', topic_id: 't6', week_no: 7 }]
    TABLES.topics = [
      { id: 't5', title: 'Первый закон', is_open: true, available_from: null, order_index: 5, module: { course_id: 'c1', order_index: 1 } },
      { id: 't6', title: 'Второй закон Ньютона', is_open: null, available_from: '2099-01-01', order_index: 6, module: { course_id: 'c1', order_index: 1 } },
    ]
    await renderHome()
    const cal = await screen.findByTestId('home-calendar')
    expect(within(cal).getByRole('link', { name: /Первый закон/ })).toHaveAttribute('href', '/my-course/g1/topic/t5')
    expect(within(cal).getByTestId('cal-topic-locked')).toHaveTextContent('Второй закон Ньютона')
    delete TABLES.course_study_plans
    delete TABLES.course_study_plan_items
    delete TABLES.topics
  })
})
