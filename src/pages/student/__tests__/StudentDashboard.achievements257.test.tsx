import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildStudentTodo } from '@/lib/studentTodo'
import type { HomeActivity } from '@/lib/studentHome'
import { useToastStore } from '@/store/toastStore'
import { syncResponse } from '@/test/achievementsFixture'
import { buildForecastView, normalizeForecastResponse } from '@/lib/egeForecast'
import { EGE_SPECS } from '@/lib/egeScales'

/**
 * §257. Главная: три последние награды в «Баллах школы», тост новой награды,
 * прогноз → значки «Рост прогноза» (claim_forecast_achievement). Хуки
 * настоящие (`useAchievements`, `useExamForecast`, `useSchoolPoints`) —
 * подменён только `supabase.rpc`. Начало файла — как в
 * StudentDashboard.forecast.test.tsx (те же данные прогноза).
 */
const NOW = new Date()
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()

type Row = { subject: string; ns: number[]; source: string; score: number; at: string; item: string; kim_total?: number | null }
const state = {
  courses: [] as Array<{ courseId: string; groupId: string; courseTitle: string; subject: string | null; examType: string | null }>,
  activity: null as HomeActivity | null,
  forecast: null as unknown,
  forecastError: null as string | null,
  points: null as unknown,
  sync: null as unknown,
  syncAfterClaim: null as unknown,
  claimFresh: [] as string[],
  claimed: false,
  rpcCalls: [] as Array<[string, Record<string, unknown> | undefined]>,
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      state.rpcCalls.push([fn, args])
      if (fn === 'student_exam_forecast_evidence') {
        return Promise.resolve(state.forecastError ? { data: null, error: { message: state.forecastError } } : { data: state.forecast, error: null })
      }
      if (fn === 'student_school_points') return Promise.resolve({ data: state.points, error: null })
      if (fn === 'student_achievements_sync') {
        return Promise.resolve(state.sync ? { data: state.claimed && state.syncAfterClaim ? state.syncAfterClaim : state.sync, error: null } : { data: null, error: { message: 'нет функции' } })
      }
      if (fn === 'claim_forecast_achievement') {
        state.claimed = true
        return Promise.resolve({ data: { subject: args?.p_subject, fresh: state.claimFresh }, error: null })
      }
      if (fn === 'set_my_exam_goal') {
        const g = args?.p_goal as number | null
        return Promise.resolve(g === 13 ? { data: null, error: { message: 'Цель можно поставить только по предмету своего курса ЕГЭ' } } : { data: g, error: null })
      }
      return Promise.resolve({ data: null, error: { message: 'нет функции' } })
    },
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Shavaleev Almir' } }),
}))
vi.mock('@/hooks/useStudentDashboard', () => ({ useStudentDashboard: () => ({ courses: state.courses, studentId: 'st-1', loading: false }) }))
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: () => ({ todo: buildStudentTodo({ rawAttempts: [], homework: [], tests: [], verdicts: [] }), loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useStudentHomeActivity', () => ({
  useStudentHomeActivity: () => ({ activity: state.activity, loading: false, error: null, retry: vi.fn() }),
}))
vi.mock('@/hooks/useStudentTopicJournal', () => ({
  useStudentTopicJournal: () => ({ journal: { homework: [], tests: [], summary: {} }, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/hooks/useMyMockExams', () => ({ useMyMockExams: () => ({}) }))

import { StudentDashboard } from '@/pages/student/StudentDashboard'

const MATH_EGE = { courseId: 'c-m', groupId: 'g-m', courseTitle: 'Математика ЕГЭ', subject: 'math', examType: 'ege' }
const PHYS_EGE = { courseId: 'c-p', groupId: 'g-p', courseTitle: 'Физика ЕГЭ', subject: 'physics', examType: 'ege' }

/** Математика: все 12 номеров части 1 по 4 задачи (верно 3 из 4), №6 — хуже; физика — 3 номера (мало). */
function evidence(): Row[] {
  const out: Row[] = []
  let i = 0
  for (let n = 1; n <= 12; n++) {
    for (let k = 0; k < 4; k++) {
      const ok = n === 6 ? k === 0 : k < 3
      out.push({ subject: 'math', ns: [n], source: 'hw', score: ok ? 1 : 0, at: iso(3 + k), item: `hw:${i++}` })
    }
  }
  out.push({ subject: 'math', ns: [13, 14], source: 'hw', score: 1, at: iso(2), item: 'hw:tri' })
  out.push({ subject: 'math', ns: [1], source: 'mock', score: 1, at: iso(5), item: 'mock:1', kim_total: 19 })
  out.push({ subject: 'math', ns: [7], source: 'catalog', score: 1, at: iso(1), item: 'catalog:1' })
  for (const n of [1, 2, 5]) out.push({ subject: 'physics', ns: [n], source: 'hw', score: 1, at: iso(2), item: `hw:p${n}` })
  return out
}

function forecastResponse(over: Record<string, unknown> = {}) {
  return {
    now: NOW.toISOString(),
    subjects: [
      { subject: 'math', goal: 80, teacher_goal: 70 },
      { subject: 'physics', goal: null, teacher_goal: null },
    ],
    titles: [
      { subject: 'math', n: 6, title: 'Простейшие уравнения', section_id: 'sec-6' },
      { subject: 'math', n: 7, title: 'Вычисления', section_id: 'sec-7' },
      { subject: 'math', n: 2, title: 'Векторы', section_id: 'sec-2' },
      { subject: 'math', n: 3, title: 'Стереометрия', section_id: 'sec-3' },
      { subject: 'math', n: 4, title: 'Вероятность', section_id: 'sec-4' },
    ],
    // §256: зону номера считает база; клиент своих порогов не держит
    numbers: [
      { subject: 'math', n: 6, zone: 'growth', share: 0.25, solved: 3 },
      { subject: 'math', n: 7, zone: 'confident', share: 0.8, solved: 1 },
      { subject: 'math', n: 2, zone: 'confident', share: 0.75, solved: 0 },
      { subject: 'math', n: 3, zone: 'progress', share: 0.6, solved: 12 },
      { subject: 'math', n: 4, zone: 'progress', share: 0.7, solved: 0 },
    ],
    catalog_rules: {
      window_days: 60, low: 0.4, high: 0.7, daily_task: 10, weekly_goal: 40, weekly_target: 10, checks_per_minute: 30,
      zones: [
        { key: 'growth', per_task: 5, milestones: [{ at: 10, bonus: 30 }, { at: 20, bonus: 50 }, { at: 30, bonus: 80 }] },
        { key: 'progress', per_task: 3, milestones: [{ at: 10, bonus: 20 }, { at: 20, bonus: 30 }, { at: 30, bonus: 40 }] },
        { key: 'confident', per_task: 1, milestones: [{ at: 10, bonus: 5 }, { at: 20, bonus: 5 }, { at: 30, bonus: 5 }] },
      ],
    },
    evidence: evidence(),
    ...over,
  }
}

const POINTS = {
  total: 340,
  level: { n: 4, name: 'Упорство', from: 300, next: 450, next_name: 'Система' },
  rules: { hw_ontime: 10, hw_late: 4, grade5: 10, grade4: 6, accepted: 6, catalog: 2, mock_point: 1, streak_day: 3 },
  feed: [{ kind: 'hw_ontime', at: iso(0), points: 10, title: 'Динамика', n: null }],
}

function activity(today: string): HomeActivity {
  return { today, from: today, streak: 2, record: 8, visitedToday: true, visits: [today], solved: [], courses: [] }
}

async function renderHome() {
  const r = render(<MemoryRouter><StudentDashboard /></MemoryRouter>)
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
  return r
}

const HAVE = { catalog: 23, hw: 18, streak: 9 }
const AT = {
  'hw:10': '2026-10-02T10:00:00Z', 'streak:7': '2026-10-01T10:00:00Z', 'catalog:20': '2026-10-02T12:00:00Z', 'catalog:1': '2026-09-01T10:00:00Z',
}

beforeEach(() => {
  state.courses = [PHYS_EGE, MATH_EGE]
  state.activity = activity('2026-10-02')
  state.forecast = forecastResponse()
  state.forecastError = null
  state.points = POINTS
  state.sync = syncResponse({ have: HAVE, earnedAt: AT })
  state.syncAfterClaim = null
  state.claimFresh = []
  state.claimed = false
  state.rpcCalls = []
  useToastStore.setState({ toasts: [] })
})

describe('главная §257: награды в «Баллах школы»', () => {
  it('три последние награды и ссылка «Все достижения →»', async () => {
    await renderHome()
    const block = await screen.findByTestId('points-awards')
    const rows = block.querySelectorAll('[data-award]')
    expect([...rows].map(r => r.getAttribute('data-award'))).toEqual(['catalog:20', 'hw:10', 'streak:7'])
    expect(block).toHaveTextContent('20 задач каталога+25')
    expect(block).toHaveTextContent('Серия 7 дней+10')
    expect(within(block).getByTestId('points-all-achievements')).toHaveAttribute('href', '/achievements')
  })

  it('новичок — «Первая награда — за…»; sync не удался — только ссылка', async () => {
    state.sync = syncResponse()
    const r = await renderHome()
    expect(await screen.findByTestId('points-awards')).toHaveTextContent('Первая награда — за первую верную задачу каталога или сданное ДЗ.')
    r.unmount()
    state.sync = null
    await renderHome()
    const block = await screen.findByTestId('points-awards')
    expect(block.querySelectorAll('[data-award]')).toHaveLength(0)
    expect(within(block).getByTestId('points-all-achievements')).toBeInTheDocument()
  })

  it('свежая награда — тост «Новая награда: 20 ДЗ · +25» и баллы перечитываются (уже с наградой)', async () => {
    state.sync = syncResponse({ have: { ...HAVE, hw: 20 }, fresh: ['hw:20'] })
    await renderHome()
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Новая награда: 20 ДЗ · +25'])
    expect(state.rpcCalls.filter(([fn]) => fn === 'student_school_points').length).toBe(2)
  })

  it('прогноз сообщается базе только по предмету с баллом: текущий и первая неделя; значок — тостом без «+»', async () => {
    state.claimFresh = ['forecast:5']
    state.syncAfterClaim = syncResponse({ have: { ...HAVE, forecast: 6 }, earnedAt: AT })
    await renderHome()
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
    const claims = state.rpcCalls.filter(([fn]) => fn === 'claim_forecast_achievement').map(([, a]) => a)
    const data = normalizeForecastResponse(forecastResponse())!
    const view = buildForecastView(EGE_SPECS['math:2026'], data.evidence, data.now)
    expect(claims).toEqual([{ p_subject: 'math', p_first_score: view.trend.find(t => t.score != null)!.score, p_current_score: view.score }])
    expect(state.rpcCalls.filter(([fn]) => fn === 'student_achievements_sync').length).toBeGreaterThanOrEqual(2)
    expect(useToastStore.getState().toasts.map(t => t.message)).toContain('Новая награда: Прогноз +5')
    // значок без баллов — баллы школы не перечитываются ради него
    expect(state.rpcCalls.filter(([fn]) => fn === 'student_school_points').length).toBe(1)
  })
})
