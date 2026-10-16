import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Главная ученика «как в Notion» (письмо ЛК_стиль_главная_как_notion.md, 16.10).
 *
 * Хуки главной настоящие, подменён Supabase — «записывающим» клиентом: так
 * проверяется и картинка, и то, КАКИЕ запросы главная делает. Хуки соседних
 * экранов (журнал ДЗ, программа курса) и приглашение в Telegram подменены:
 * у них свои тесты, здесь — только то, как главная их показывает.
 */

const calls: string[] = []
const RPC: Record<string, unknown> = {
  my_mock_exams: [],
  // Хранимый прогноз (forecast-daily, письмо 16.10).
  my_score_forecast: [{ subject: 'physics', score: 64, low: 58, high: 70, basis: 'по 46 задачам', details: { v: 1, ready: true }, computed_at: '2026-10-16T01:10:00Z' }],
  my_weekly_goals: { current: null, next: null, goals: [{ kind: 'days', target: 4, progress: 3, done: false }, { kind: 'topics', target: 2, progress: 2, done: true }] },
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
  student_exam_goals: [{ subject: 'physics', goal: 80 }],
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
  const state = { profile: { id: 'profile-1', full_name: 'Шавалеев Альмир', role: 'student', avatar_url: null } }
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) }
})
vi.mock('@/components/shared/TelegramOnboarding', () => ({
  TelegramOnboarding: ({ compact }: { compact?: boolean }) => <div data-testid="tg-line" data-compact={compact || undefined} />,
}))
const hw = vi.hoisted(() => ({
  todo: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: () => ({
    buckets: { todo: hw.todo },
    loading: false,
    topicLink: (r: { topic_id: string }) => `/my-course/g1/topic/${r.topic_id}`,
  }),
}))
const topic = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, kind: 'lesson', hw_id: `hw-${id}`, hw_status: null, hw_due_at: null, available_from: null, is_open: true, progress: null, ...extra,
})
vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    loading: false,
    modules: [{
      id: 'm2', title: 'Динамика',
      topics: [
        topic('t5', 'Первый закон Ньютона', { hw_status: 'accepted' }),
        topic('t6', 'Второй закон Ньютона'),
        topic('t7', 'Принцип суперпозиции', { hw_id: null }),
        topic('t8', 'Третий закон Ньютона', { is_open: null, available_from: '2099-10-19T00:00:00Z' }),
      ],
    }],
  }),
}))

import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { useVisibleObserver } from '@/test/visibleObserver'

useVisibleObserver()

async function renderHome() {
  render(<MemoryRouter initialEntries={['/student']}><StudentDashboard /></MemoryRouter>)
  await screen.findByTestId('student-home')
  await screen.findByTestId('hero-continue')
}

beforeEach(() => { calls.length = 0; hw.todo = []; try { localStorage.clear() } catch { /* нет */ } })

describe('главная ученика «как в Notion»', () => {
  it('шапка: обложка, «Имя · подготовка к ЕГЭ», свойства — цель, курс, серия; Telegram строкой', async () => {
    RPC.student_home_activity = { today: '2026-10-15', streak: 3, record: 9, visits: [], solved: [] }
    await renderHome()
    expect(screen.getByTestId('home-cover')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Альмир · подготовка к ЕГЭ')
    expect(await screen.findByTestId('home-prop-goal')).toHaveTextContent('Физика 80+ · прогноз 64')
    expect(screen.getByTestId('home-prop-goal').getAttribute('title')).toMatch(/по 46 задачам · обновлено .* в 04:10/)
    expect(screen.getByTestId('home-prop-course')).toHaveTextContent('Физика ЕГЭ')
    expect(within(screen.getByTestId('home-prop-course')).getByRole('link')).toHaveAttribute('href', '/my-course/g1')
    expect(await screen.findByTestId('home-prop-streak')).toHaveTextContent('3 дня подряд')
    expect(screen.getByTestId('tg-line')).toHaveAttribute('data-compact', 'true')
    delete RPC.student_home_activity
  })

  it('обложку можно сменить — выбор запоминается', async () => {
    await renderHome()
    expect(screen.getByTestId('home-cover')).toHaveAttribute('data-cover', 'orbit')
    fireEvent.click(screen.getByTestId('home-cover-change'))
    fireEvent.click(screen.getByTestId('home-cover-desk'))
    expect(screen.getByTestId('home-cover')).toHaveAttribute('data-cover', 'desk')
    expect(localStorage.getItem('almiron:home-cover:profile-1')).toBe('desk')
  })

  it('виджеты: дни до ЕГЭ с долей учебного года, часы с фразой дня', async () => {
    await renderHome()
    const exam = screen.getByTestId('home-w-exam')
    expect(within(exam).getByTestId('exam-countdown').textContent).toMatch(/^\d+(день|дня|дней)$/)
    expect(exam).toHaveTextContent('до ЕГЭ по физике · ≈ 1 июня')
    expect(within(exam).getByTestId('home-year-pct')).toHaveTextContent(/учебный год пройден на \d+ %/)
    expect(screen.getByTestId('home-w-clock').querySelectorAll('.stu-flip span')).toHaveLength(2)
    expect(screen.getByTestId('home-phrase').textContent!.length).toBeGreaterThan(10)
  })

  it('мини-календарь месяца: та же шкала, сегодня обведено, листается назад', async () => {
    RPC.student_home_activity = { today: '2026-10-15', streak: 3, record: 9, visits: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-09-20'], solved: [{ day: '2026-10-14', n: 6 }] }
    await renderHome()
    const card = await screen.findByTestId('home-activity')
    expect(within(card).getByTestId('home-month-title')).toHaveTextContent('Октябрь 2026')
    expect(card.querySelector('[data-day="2026-10-14"]')).toHaveClass('lv-3')
    expect(card.querySelector('[data-day="2026-10-15"]')).toHaveClass('is-today')
    expect(card.querySelector('[data-day="2026-10-16"]')).toHaveClass('is-future')
    expect(card.querySelector('[data-day="2026-10-14"]')).toHaveAttribute('aria-label', 'среда, 14 октября: 6 задач')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('подряд 3 дня')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('рекорд 9')
    fireEvent.click(within(card).getByTestId('home-month-prev'))
    expect(within(card).getByTestId('home-month-title')).toHaveTextContent('Сентябрь 2026')
    expect(card.querySelector('[data-day="2026-09-20"]')).toHaveClass('lv-1')
    delete RPC.student_home_activity
  })

  it('«Цели недели» и «Сегодня» — списками с галочками: ДЗ к сдаче и следующий урок', async () => {
    hw.todo = [{ homework_id: 'h1', topic_id: 't4', topic_title: 'Сила', is_overdue: true }]
    await renderHome()
    const goals = await screen.findAllByTestId('home-weekly-goal')
    expect(goals).toHaveLength(2)
    expect(goals[1]).toHaveAttribute('data-done', 'true')
    const today = screen.getAllByTestId('home-today-item')
    expect(today.map(t => t.textContent)).toEqual(['Сдать ДЗ «Сила»просрочено', 'Урок «Второй закон Ньютона»урок'])
    expect(within(today[0]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/topic/t4')
  })

  it('«Продолжить»: три урока со следующего, замок — как в плитках курса; закрытый не ведёт', async () => {
    await renderHome()
    const cards = await screen.findAllByTestId('home-continue-card')
    expect(cards.map(c => c.getAttribute('data-state'))).toEqual(['hw', 'nohw', 'locked'])
    expect(cards[0]).toHaveTextContent('Урок 2 · Второй закон Ньютона')
    expect(within(cards[0]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/topic/t6')
    expect(within(cards[2]).getByTestId('home-continue-pill').textContent).toMatch(/^🔒/)
    expect(within(cards[2]).queryByRole('link')).toBeNull()
  })

  it('«Продолжить урок →» в шапке и карточка курса — как раньше', async () => {
    await renderHome()
    expect(screen.getByTestId('hero-continue')).toHaveAttribute('href', '/my-course/g1/topic/t6')
    const course = screen.getByTestId('home-course')
    expect(within(course).getByTestId('course-percent')).toHaveTextContent('40%')
    expect(within(course).getAllByTestId('home-module').map(m => m.textContent)).toEqual(['Кинематика80%', 'Динамика0%'])
  })

  it('снятые блоки не вернулись; запросы — те же источники, без новых RPC', async () => {
    await renderHome()
    for (const text of [/Задача дня/, /Баллы школы/, /Примерный балл/, /Вернули на доработку/]) {
      expect(screen.queryByText(text)).toBeNull()
    }
    await waitFor(() => expect(calls).toContain('rpc:student_home_activity'))
    await waitFor(() => expect(calls).toContain('rpc:my_weekly_goals'))
    const uniq = [...new Set(calls)].sort()
    for (const c of uniq) {
      expect([
        'from:group_students', 'from:student_exam_goals', 'from:students',
        'rpc:my_course_demo', 'rpc:my_mock_exams', 'rpc:my_score_forecast', 'rpc:my_subscriptions', 'rpc:my_weekly_goals',
        'rpc:student_home_activity', 'rpc:student_home_courses', 'rpc:subscriptions_enabled',
      ]).toContain(c)
    }
  })
})
