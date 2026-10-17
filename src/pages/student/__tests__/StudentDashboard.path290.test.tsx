import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { buildStudentTodo } from '@/lib/studentTodo'
import type { StudentPathHome } from '@/lib/studentPath'

/**
 * §290-B. Главная ученика и путь «с улицы»: без анкеты — на /start; с
 * пробным — плашка и «Продолжить урок»; подписка закрыта (школьники) —
 * запроса нет, главная прежняя.
 */

const state = vi.hoisted(() => ({
  enabled: true,
  path: null as StudentPathHome | null,
  pathCalls: [] as Array<[unknown, unknown]>,
}))

vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: state.enabled, loading: false }) }))
vi.mock('@/hooks/useStudentPath', () => ({
  useStudentPathHome: (id: unknown, enabled: unknown) => {
    state.pathCalls.push([id, enabled])
    return { data: enabled ? state.path : null, loading: false, refresh: vi.fn() }
  },
}))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Петрова Аня' } }),
}))
vi.mock('@/hooks/useStudentDashboard', () => ({ useStudentDashboard: () => ({ loading: false, courses: [], studentId: null }) }))
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: () => ({ todo: buildStudentTodo({ rawAttempts: [], homework: [], tests: [], verdicts: [] }), loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useStudentHomeActivity', () => ({ useStudentHomeActivity: () => ({ activity: null, loading: false, error: null, retry: vi.fn() }) }))
vi.mock('@/hooks/useStudentTopicJournal', () => ({ useStudentTopicJournal: () => ({ journal: null, loading: false, error: null, reload: vi.fn() }) }))
vi.mock('@/hooks/useMyMockExams', () => ({ useMyMockExams: () => ({}) }))

import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { useVisibleObserver } from '@/test/visibleObserver'

useVisibleObserver()

const onboarding = (needed: boolean): StudentPathHome['onboarding'] => ({
  needed, completed: !needed, grade: 11, exam: 'ege', subject: 'physics', target_score: 80,
  months_to_exam: 8, hours_per_week: 6, diagnostic_status: 'none',
})

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/student']}>
      <Routes>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/start" element={<div data-testid="start-page" />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.enabled = true
  state.path = null
  state.pathCalls = []
})

describe('§290-B главная', () => {
  it('анкета не пройдена — на /start', async () => {
    state.path = { onboarding: onboarding(true), subscriptions: [] }
    renderHome()
    expect(await screen.findByTestId('start-page')).toBeInTheDocument()
  })

  it('пробный — плашка; «Продолжить урок» не дублируется (карточка одна — «лёгкой» главной)', async () => {
    state.path = {
      onboarding: onboarding(false),
      subscriptions: [{
        subscription_id: 's1', course_id: 'c1', course_title: 'Физика ЕГЭ', group_id: 'g1', tariff_id: 't1',
        status: 'trial', source: 'trial', demo: true, has_access: true,
        access_until: new Date(Date.now() + 30 * 3600_000).toISOString(), auto_renew: false,
        continue: { topic_id: 'tp1', title: 'Кинематика', module_title: 'Механика' },
      }],
    }
    renderHome()
    expect(await screen.findByTestId('subscription-path-banner')).toHaveTextContent('До конца пробного — 2 дня')
    expect(screen.queryByTestId('subscription-path-continue')).toBeNull()
  })

  it('подписка закрыта (школьник) — без запроса пути и без плашек', async () => {
    state.enabled = false
    state.path = { onboarding: onboarding(true), subscriptions: [] }
    renderHome()
    expect(await screen.findByTestId('student-home')).toBeInTheDocument()
    expect(screen.queryByTestId('subscription-path')).toBeNull()
    expect(state.pathCalls.every(([, enabled]) => enabled === false)).toBe(true)
  })
})
