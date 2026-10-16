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
  it('«Цель: физика 80+», основание и цели недели с прогрессом', async () => {
    st.exam = [{ subject: 'physics', goal: 80 }]
    st.rpc.my_regular_goals = [
      { id: 'g1', kind: 'numbers', subject: 'physics', numbers: [3], target: 10, progress: 4, done: false },
      { id: 'g2', kind: 'days', target: 3, progress: 3, done: true },
    ]
    render(<MemoryRouter><GoalsCard profileId="p1" sources={[{ subject: 'physics', mock: null, course: { done: 23, total: 102 } }]} /></MemoryRouter>)
    const goal = await screen.findByTestId('home-exam-goal-physics')
    expect(goal).toHaveTextContent('Цель: физика 80+')
    expect(goal).toHaveTextContent('пройдено 23 из 102 тем курса')
    expect(screen.getAllByTestId('home-weekly-goal')).toHaveLength(2)
    expect(screen.getByTestId('home-goals-summary')).toHaveTextContent('выполнено 1 из 2')
  })

  it('целей нет — ссылка «Поставить цели» в настройки', async () => {
    st.rpc.my_regular_goals = []
    render(<MemoryRouter><GoalsCard profileId="p1" sources={[]} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Поставить цели' })).toHaveAttribute('href', '/settings?tab=goals')
  })
})

describe('цели у преподавателя', () => {
  it('цель на экзамен и цели недели с выполнением — только чтение', async () => {
    st.rpc.student_goals_for_staff = {
      exam: [{ subject: 'math', goal: 70 }],
      weekly: [{ id: 'g1', kind: 'tasks', target: 30, progress: 31, done: true }, { id: 'g2', kind: 'days', target: 5, progress: 2, done: false }],
    }
    render(<StudentGoalsStaffBlock studentId="s1" />)
    expect(await screen.findByTestId('student-goals-staff-exam')).toHaveTextContent('Сдать математику на 70+')
    expect(screen.getByTestId('student-goals-staff-summary')).toHaveTextContent('выполнено 1 из 2')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
