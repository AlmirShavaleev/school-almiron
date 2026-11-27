import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Главная ученика «как в Notion» (письмо ЛК_стиль_главная_как_notion.md, 16.10).
 *
 * Хуки главной настоящие, подменён Supabase — «записывающим» клиентом: так
 * проверяются содержимое и запросы главной. Хуки журнала ДЗ и программы курса
 * подменены, чтобы проверить, что главная их не вызывает.
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
const { homeworkLoad, courseProgramLoad } = vi.hoisted(() => ({
  homeworkLoad: vi.fn(),
  courseProgramLoad: vi.fn(() => ({ loading: false, modules: [] })),
}))
vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: homeworkLoad,
}))
vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: courseProgramLoad,
}))

import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { useVisibleObserver } from '@/test/visibleObserver'

useVisibleObserver()

async function renderHome() {
  render(<MemoryRouter initialEntries={['/student']}><StudentDashboard /></MemoryRouter>)
  await screen.findByTestId('student-home')
  await screen.findByTestId('hero-continue')
}

beforeEach(() => {
  calls.length = 0
  homeworkLoad.mockClear()
  courseProgramLoad.mockClear()
  try { localStorage.clear() } catch { /* нет */ }
})

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
    // Нажатие на день — строка под сеткой: что было в этот день; по умолчанию — сегодня.
    expect(within(card).getByTestId('home-day-info')).toHaveTextContent('сегодня, четверг, 15 октября: заходил, задач не решал')
    const day14 = within(card.querySelector('[data-day="2026-10-14"]') as HTMLElement).getByRole('button')
    expect(day14).toHaveAccessibleName('среда, 14 октября: 6 задач')
    fireEvent.click(day14)
    expect(within(card).getByTestId('home-day-info')).toHaveTextContent('среда, 14 октября: 6 задач')
    expect(card.querySelector('[data-day="2026-10-14"]')).toHaveClass('is-picked')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('подряд 3 дня')
    expect(within(card).getByTestId('home-streak')).toHaveTextContent('рекорд 9')
    fireEvent.click(within(card).getByTestId('home-month-prev'))
    expect(within(card).getByTestId('home-month-title')).toHaveTextContent('Сентябрь 2026')
    expect(card.querySelector('[data-day="2026-09-20"]')).toHaveClass('lv-1')
    delete RPC.student_home_activity
  })

  it('не показывает недельные цели и «Сегодня» и не загружает их данные', async () => {
    await renderHome()
    await waitFor(() => expect(screen.getByTestId('forecast-physics-value')).toHaveTextContent('58–70'))
    expect(screen.queryByText('Цели недели')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Сегодня' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-weekly-goal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-today-item')).not.toBeInTheDocument()
    expect(calls).not.toContain('rpc:my_weekly_goals')
    expect(homeworkLoad).not.toHaveBeenCalled()
  })

  it('карточки «Продолжить» убраны, полная программа курса не загружается', async () => {
    await renderHome()
    expect(screen.queryByRole('heading', { name: 'Продолжить' })).not.toBeInTheDocument()
    expect(courseProgramLoad).not.toHaveBeenCalled()
  })

  it('убирает прогресс по курсам с главной, сохраняет быстрый переход в урок и курс', async () => {
    await renderHome()
    expect(screen.getByTestId('hero-continue')).toHaveAttribute('href', '/my-course/g1/topic/t6')
    expect(within(screen.getByTestId('home-prop-course')).getByRole('link')).toHaveAttribute('href', '/my-course/g1')
    expect(screen.queryByTestId('courses-card')).not.toBeInTheDocument()
    expect(screen.queryByText('Прогресс по ДЗ')).not.toBeInTheDocument()
  })

  it('снятые блоки не вернулись; запросы — те же источники, без новых RPC', async () => {
    await renderHome()
    for (const text of [/Задача дня/, /Баллы школы/, /Примерный балл/, /Вернули на доработку/]) {
      expect(screen.queryByText(text)).toBeNull()
    }
    await waitFor(() => expect(calls).toContain('rpc:student_home_activity'))
    expect(calls).not.toContain('rpc:my_weekly_goals')
    const uniq = [...new Set(calls)].sort()
    for (const c of uniq) {
      expect([
        'from:group_students', 'from:student_exam_goals', 'from:students',
        'rpc:my_course_demo', 'rpc:my_mock_exams', 'rpc:my_score_forecast', 'rpc:my_subscriptions',
        'rpc:student_home_activity', 'rpc:student_home_courses', 'rpc:subscriptions_enabled',
      ]).toContain(c)
    }
  })

  it('главная не повторяет запрос хранимого прогноза для виджета', async () => {
    await renderHome()
    await waitFor(() => expect(screen.getByTestId('forecast-physics-value')).toHaveTextContent('58–70'))
    expect(calls.filter(c => c === 'rpc:my_score_forecast')).toHaveLength(1)
    expect(calls).not.toContain('rpc:student_exam_forecast_evidence')
  })

  it('показывает сроки и фигуры по статусам планов из существующего ответа главной', async () => {
    const saved = RPC.student_home_courses
    const planData = { title: 'План на неделю', starts_on: '2026-11-27', total: 7, overdue: 0, items: [], course_titles: ['Физика'] }
    RPC.student_home_courses = (saved as object[]).map(course => ({ ...course, work_plans: {
      today: '2026-11-27', plans: [
        { ...planData, id: 'week-1', ends_on: '2026-12-03', done: 1 },
        { ...planData, id: 'week-2', ends_on: '2026-12-10', done: 0 },
        { ...planData, id: 'week-3', ends_on: '2026-12-17', done: 7 },
      ],
    } }))
    try {
      await renderHome()
      const plan = await screen.findByTestId('home-work-plan')
      expect(screen.getByTestId('home-widgets').compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const cards = within(plan)
      const started = cards.getByRole('article', { name: 'Срок до 3 дек.' })
      const todo = cards.getByRole('article', { name: 'Срок до 10 дек.' })
      const completed = cards.getByRole('article', { name: 'Срок до 17 дек.' })
      expect(started.querySelector('img')).toHaveAttribute('src', '/brand/stu/plan-rocket.webp')
      expect(todo.querySelector('img')).toHaveAttribute('src', '/brand/stu/plan-clock.webp')
      expect(completed.querySelector('img')).toHaveAttribute('src', '/brand/stu/plan-target.webp')
      expect(todo).toHaveTextContent('Не начато')
      expect(completed).toHaveTextContent('Выполнено')
      const card = within(started)
      expect(card.getByText('Физика')).toBeInTheDocument()
      expect(card.getByText('В процессе')).toBeInTheDocument()
      expect(card.queryByText('План на неделю')).toBeNull()
      expect(card.getByText('Выполнено 1 из 7 · осталось 6')).toBeInTheDocument()
      expect(card.queryByText('На сегодня')).toBeNull()
      expect(card.getByRole('link', { name: 'Открыть весь план' })).toHaveAttribute('href', '/my-work-plan/week-1')
      expect(calls.filter(c => c === 'rpc:student_home_courses')).toHaveLength(1)
      expect(calls).not.toContain('rpc:student_work_plan_read')
    } finally { RPC.student_home_courses = saved }
  })

  it('виджет «Прогноз ЕГЭ»: только диапазон; данных мало — «0»', async () => {
    await renderHome()
    await waitFor(() => expect(screen.getByTestId('forecast-physics-value')).toHaveTextContent('58–70'))
    expect(screen.getByTestId('forecast-physics')).toHaveTextContent('Прогноз ЕГЭ · физика')
    expect(screen.getByTestId('home-w-forecast').textContent).not.toMatch(/обновлено|задач|цель/i)
  })

  it('виджет «Прогноз ЕГЭ»: строки нет — «0», без пояснений', async () => {
    const saved = RPC.my_score_forecast
    RPC.my_score_forecast = [{ subject: 'physics', score: null, low: null, high: null, basis: 'по 3 задачам', details: { v: 1, ready: false }, computed_at: '2026-10-16T01:10:00Z' }]
    await renderHome()
    await waitFor(() => expect(screen.getByTestId('forecast-physics-value')).toHaveTextContent(/^0$/))
    RPC.my_score_forecast = saved
  })
})
