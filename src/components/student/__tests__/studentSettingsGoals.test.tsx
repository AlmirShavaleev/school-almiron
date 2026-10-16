import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// «Настройки» ученика и цели (письмо ЛК_стиль_настройки_ученика.md, 16.10).
const st = vi.hoisted(() => ({
  prefs: null as Record<string, unknown> | null,
  linked: false,
  rpc: {} as Record<string, unknown>,
  exam: [] as unknown[],
}))

function chain(data: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve({ data, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f)
  c.upsert = () => Promise.resolve({ data: null, error: null })
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'notification_prefs') return chain(st.prefs)
      if (t === 'telegram_connections') return chain(st.linked ? { telegram_chat_id: 1, telegram_username: 'u', is_enabled: true, connected_at: '2026-10-01' } : null)
      if (t === 'student_exam_goals') return chain(st.exam)
      return chain(null)
    },
    rpc: (fn: string) => Promise.resolve({ data: st.rpc[fn] ?? null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}))

import { StudentNotificationsTab } from '@/components/student/settings/StudentNotificationsTab'
import { GoalsCard } from '@/components/student/home/GoalsCard'
import { StudentGoalsStaffBlock } from '@/components/student/StudentGoalsStaffBlock'

beforeEach(() => { st.prefs = null; st.linked = false; st.rpc = {}; st.exam = [] })

describe('уведомления ученика', () => {
  it('группы «Домашние задания», «Пробники», «Подписка», «Каналы»; занятий и достижений нет', async () => {
    render(<StudentNotificationsTab profileId="p1" />)
    expect(await screen.findByTestId('student-notif-group-homework')).toBeInTheDocument()
    for (const g of ['mocks', 'subscription', 'channels']) expect(screen.getByTestId(`student-notif-group-${g}`)).toBeInTheDocument()
    expect(screen.queryByText(/Напоминание о занятии/)).toBeNull()
    expect(screen.queryByText(/достижени/i)).toBeNull()
    expect(screen.queryByText(/Email-рассылки/)).toBeNull()
    expect(screen.getByTestId('student-notif-email')).toHaveTextContent('только письма о подписке')
  })

  it('Telegram не привязан — переключатели неактивны, подсказка про «Каналы»', async () => {
    render(<StudentNotificationsTab profileId="p1" />)
    expect(await screen.findByTestId('student-notif-hint')).toHaveTextContent('Привяжите Telegram')
    await waitFor(() => expect(within(screen.getByTestId('student-notif-homework')).getByRole('switch')).toBeDisabled())
  })

  it('привязан и включён — переключатели активны', async () => {
    st.linked = true
    st.prefs = { telegram: true, homework: false }
    render(<StudentNotificationsTab profileId="p1" />)
    const sw = await waitFor(() => {
      const el = within(screen.getByTestId('student-notif-homework')).getByRole('switch')
      expect(el).not.toBeDisabled()
      return el
    })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('student-notif-hint')).toBeNull()
  })
})

describe('цели на главной', () => {
  it('«Цель: физика 80+», основание и цели недели от преподавателя с прогрессом', async () => {
    st.exam = [{ subject: 'physics', goal: 80 }]
    st.rpc.my_weekly_goals = [{ course_id: 'c1', course_title: 'Физика', goals: [
      { kind: 'days', target: 5, progress: 3, done: false },
      { kind: 'topics', target: 2, progress: 2, done: true },
    ] }]
    render(<MemoryRouter><GoalsCard profileId="p1" sources={[{ subject: 'physics', mock: null, course: { done: 23, total: 102 } }]} /></MemoryRouter>)
    const goal = await screen.findByTestId('home-exam-goal-physics')
    expect(goal).toHaveTextContent('Цель: физика 80+')
    expect(goal).toHaveTextContent('пройдено 23 из 102 тем курса')
    const goals = screen.getAllByTestId('home-weekly-goal')
    expect(goals[0]).toHaveTextContent('Заходить на платформу 5 дней в неделю3 из 5 дней')
    expect(screen.getByTestId('home-goals-summary')).toHaveTextContent('выполнено 1 из 2')
    expect(screen.getByTestId('home-goals')).toHaveTextContent('Цели недели ставит преподаватель')
  })

  it('целей недели нет — блока целей недели нет, цель на экзамен — ссылкой', async () => {
    st.rpc.my_weekly_goals = []
    render(<MemoryRouter><GoalsCard profileId="p1" sources={[]} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Выбрать балл' })).toHaveAttribute('href', '/settings?tab=goals')
    expect(screen.queryByTestId('home-weekly-goal')).toBeNull()
  })
})

describe('цели у преподавателя', () => {
  it('цель на экзамен, цели недели с выполнением, «как у курса», история 8 недель', async () => {
    st.rpc.student_goals_for_staff = {
      exam: [{ subject: 'math', goal: 70 }],
      courses: [{
        course_id: 'c1', course_title: 'Физика', custom: false,
        course_goals: { days: 4, topics: null, tasks: 30 }, own_goals: null,
        goals: [{ kind: 'tasks', target: 30, progress: 31, done: true }, { kind: 'days', target: 4, progress: 2, done: false }],
        history: Array.from({ length: 8 }, (_, i) => ({ week_start: `2026-08-${String(24 + i).padStart(2, '0')}`, total: 2, done: i % 2 ? 2 : 1 })),
      }],
    }
    render(<StudentGoalsStaffBlock studentId="s1" />)
    expect(await screen.findByTestId('student-goals-staff-exam')).toHaveTextContent('Сдать математику на 70+')
    expect(screen.getByTestId('student-goals-staff-summary')).toHaveTextContent('выполнено 1 из 2')
    expect(screen.getByTestId('student-goals-mode')).toHaveTextContent('как у курса')
    expect(within(screen.getByTestId('student-goals-history')).getAllByText(/\d\/2/)).toHaveLength(8)
  })
})
