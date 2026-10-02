import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildStudentTodo } from '@/lib/studentTodo'
import type { HomeActivity } from '@/lib/studentHome'

/**
 * §256. Главная: «Задача дня» (золотая рамка, над прогнозом), «Цель недели»,
 * серия по дням с решением. Хуки задачи дня, прогноза и баллов НАСТОЯЩИЕ —
 * подменён только `supabase.rpc`.
 */
const NOW = new Date()
const iso = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const state = {
  courses: [] as Array<{ courseId: string; groupId: string; courseTitle: string; subject: string | null; examType: string | null }>,
  activity: null as HomeActivity | null,
  daily: null as unknown,
  weekly: null as unknown,
  evidence: [] as unknown[],
  calls: [] as Array<[string, Record<string, unknown> | undefined]>,
}
function evidence() {
  const out: unknown[] = []
  let i = 0
  for (let n = 1; n <= 12; n++) for (let k = 0; k < 4; k++) out.push({ subject: 'math', ns: [n], source: 'hw', score: n === 6 ? 0 : k < 3 ? 1 : 0, at: iso(3 + k), item: `hw:${i++}` })
  return out
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      state.calls.push([fn, args])
      const ok = (data: unknown) => Promise.resolve({ data, error: null })
      if (fn === 'student_daily_task') return ok(state.daily)
      if (fn === 'student_weekly_goal') return ok(state.weekly)
      if (fn === 'student_exam_forecast_evidence') return ok({ now: NOW.toISOString(), subjects: [{ subject: 'math', goal: null }], titles: [], evidence: state.evidence })
      if (fn === 'catalog_check_answer') {
        const correct = String(args?.p_answer).trim() === '5'
        if (correct) {
          // база записала попытку: в свидетельствах, цели недели и задаче дня она уже есть
          state.evidence = [...state.evidence, { subject: 'math', ns: [6], source: 'catalog', score: 1, at: iso(0), item: 'catalog:t2' }]
          state.weekly = { ...(state.weekly as object), progress: 4 }
          state.daily = { ...(state.daily as object), solved: true, done: true, attempts: 2 }
        }
        return ok({ verdict: correct ? 'correct' : 'wrong', already_solved: false, counted: correct, revealed_before: false, subject: 'math', n: 6, zone: 'growth', points: correct ? 5 : 0, solved: 4, milestone_bonus: 0, daily_bonus: correct ? 10 : 0, weekly_bonus: 0, weekly: correct ? { progress: 4, target: 10 } : null, answer_html: correct ? '<p>5</p>' : null })
      }
      if (fn === 'student_school_points') return ok(null)
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
vi.mock('@/components/catalog/TaskContentRenderer', () => ({
  TaskContentRenderer: ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />,
}))

import { StudentDashboard } from '@/pages/student/StudentDashboard'

const MATH_EGE = { courseId: 'c-m', groupId: 'g-m', courseTitle: 'Математика ЕГЭ', subject: 'math', examType: 'ege' }
const PHYS_EGE = { courseId: 'c-p', groupId: 'g-p', courseTitle: 'Физика ЕГЭ', subject: 'physics', examType: 'ege' }
const MATH_OGE = { courseId: 'c-o', groupId: 'g-o', courseTitle: 'Математика ОГЭ', subject: 'math', examType: 'oge' }
const DAILY = {
  day: '2026-10-02', subject: 'math', n: 6, zone: 'growth', share: 0.25, bonus: 10, section_id: 'sec-6', title: 'Простейшие уравнения',
  task: { id: 't2', statement_html: '<p>Найдите корень уравнения log₃(x + 4) = 2.</p>', subject: 'Математика', exam_type: 'ЕГЭ', assets: [] },
  attempts: 0, revealed: false, solved: false, done: false,
}
const WEEKLY = { week_start: '2026-09-28', week_end: '2026-10-04', subject: 'math', numbers: [6, 7], sections: [{ n: 6, section_id: 'sec-6', title: 'Простейшие уравнения' }], target: 10, progress: 3, done: false, bonus: 40 }

function activity(over: Partial<HomeActivity> = {}): HomeActivity {
  return { today: '2026-10-02', from: '2026-07-11', streak: 5, record: 12, visitedToday: true, visits: ['2026-10-02'], solved: [], courses: [], streakDays: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'], solvedToday: false, ...over }
}

async function renderHome() {
  const r = render(<MemoryRouter><StudentDashboard /></MemoryRouter>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return r
}

beforeEach(() => {
  state.courses = [PHYS_EGE, MATH_EGE]
  state.activity = activity()
  state.daily = DAILY
  state.weekly = WEEKLY
  state.evidence = evidence()
  state.calls = []
  toastSuccess.mockClear()
})

describe('главная §256: задача дня и цель недели', () => {
  it('задача дня — первой в левой колонке, над целью недели и прогнозом; предмет — математика (раньше физики)', async () => {
    await renderHome()
    const daily = await screen.findByTestId('daily-task-card')
    const left = daily.parentElement!
    expect(left.getAttribute('data-slot')).toBe('left')
    expect(left.firstElementChild).toBe(daily)
    expect(daily.nextElementSibling).toBe(screen.getByTestId('weekly-goal-card'))
    expect(screen.getByTestId('weekly-goal-card').nextElementSibling).toBe(screen.getByTestId('forecast-card'))
    expect(state.calls).toContainEqual(['student_daily_task', { p_subject: 'math' }])
    expect(state.calls).toContainEqual(['student_weekly_goal', { p_subject: 'math' }])
    expect(daily).toHaveTextContent('+10 баллов школы')
    expect(daily).toHaveTextContent('Подобрана по вашему слабому номеру — №6 «Простейшие уравнения»')
    expect(daily).toHaveTextContent('log₃(x + 4) = 2')
    expect(within(daily).getByTestId('daily-streak-chip')).toHaveTextContent('серия 5 → 6 дней')
  })

  it('цель недели: два слабых номера, «3 из 10 решено», полоса, «Продолжить №6 →» в раздел', async () => {
    await renderHome()
    const w = await screen.findByTestId('weekly-goal-card')
    expect(w).toHaveTextContent('бонус +40')
    expect(w).toHaveTextContent('10 задач из двух ваших слабых номеров: №6 и №7. До воскресенья, 4 октября.')
    expect(within(w).getByTestId('weekly-progress')).toHaveTextContent('3 из 10 решено')
    expect(within(w).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(within(w).getByRole('link', { name: 'Продолжить №6 →' })).toHaveAttribute('href', '/catalog/sec-6?subject=math&exam=ege')
  })

  it('ответ прямо на главной: неверно — подсказка; верно — «+5», «задача дня +10», «+N к прогнозу», тост, цель 4 из 10', async () => {
    await renderHome()
    const daily = await screen.findByTestId('daily-task-card')
    fireEvent.change(within(daily).getByTestId('task-answer-input'), { target: { value: '4' } })
    await act(async () => { fireEvent.click(within(daily).getByTestId('task-answer-submit')) })
    expect(within(daily).getByTestId('task-answer-result')).toHaveTextContent('Пока неверно')
    expect(toastSuccess).not.toHaveBeenCalled()

    fireEvent.change(within(daily).getByTestId('task-answer-input'), { target: { value: '5' } })
    await act(async () => { fireEvent.click(within(daily).getByTestId('task-answer-submit')) })
    await waitFor(() => expect(within(daily).getByTestId('task-answer-result')).toHaveAttribute('data-counted', 'true'))
    const res = within(daily).getByTestId('task-answer-result')
    expect(res).toHaveTextContent('+5 баллов школы')
    expect(res).toHaveTextContent('задача дня +10')
    expect(within(daily).getByTestId('task-answer-forecast')).toHaveTextContent(/\+\d(,\d)? к прогнозу/)
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^\+15 баллов школы · задача дня решена · прогноз \d+$/))
    expect(state.calls).toContainEqual(['catalog_check_answer', { p_task_id: 't2', p_answer: '5' }])
    expect(screen.getByTestId('weekly-progress')).toHaveTextContent('4 из 10 решено')
  })

  it('задача дня уже решена сегодня — «Задача дня решена! +10», поля нет, фишки серии нет', async () => {
    state.daily = { ...DAILY, attempts: 1, solved: true, done: true }
    state.activity = activity({ solvedToday: true })
    await renderHome()
    const daily = await screen.findByTestId('daily-task-card')
    expect(within(daily).queryByTestId('task-answer-input')).toBeNull()
    expect(daily).toHaveTextContent('Задача дня решена! +10 баллов школы')
    expect(within(daily).queryByTestId('daily-streak-chip')).toBeNull()
  })

  it('задачи нет (всё решено / функции нет) — карточки нет, главная живёт', async () => {
    state.daily = { day: '2026-10-02', subject: 'math', task: null }
    state.weekly = { week_start: '2026-09-28', subject: 'math', numbers: null }
    await renderHome()
    expect(screen.queryByTestId('daily-task-card')).toBeNull()
    expect(screen.queryByTestId('weekly-goal-card')).toBeNull()
    expect(await screen.findByTestId('forecast-card')).toBeInTheDocument()
  })

  it('только ОГЭ — задачу дня и цель недели база не спрашивает', async () => {
    state.courses = [MATH_OGE]
    await renderHome()
    expect(state.calls.some(([f]) => f === 'student_daily_task' || f === 'student_weekly_goal')).toBe(false)
  })
})

describe('главная §256: серия по дням с решением', () => {
  it('точки недели — дни с решением (а не заходы), подпись правила; сегодня ещё нет — «не засчитан», серия не обнулена', async () => {
    await renderHome()
    const pill = screen.getByTestId('streak-pill')
    expect(pill).toHaveAttribute('title', 'Дни подряд, когда вы что-то решили: задачу каталога с проверкой, ДЗ, тест или пробник')
    expect(pill.querySelectorAll('[data-on]')).toHaveLength(4)
    expect(within(pill).getByRole('img')).toHaveAttribute('aria-label', 'Эта неделя: решали — пн, вт, ср, чт')
    expect(screen.getByTestId('streak-number')).toHaveTextContent('5')
    expect(screen.getByTestId('streak-rule')).toHaveTextContent('Сегодня ещё не засчитан — решите задачу, и серия продлится.')
    expect(screen.getByTestId('streak-rule')).toHaveTextContent('День засчитывается, если решили задачу каталога с проверкой, сдали ДЗ, тест или писали пробник.')
  })

  it('новичок по новому правилу: «Решайте хотя бы одну задачу в день…»', async () => {
    state.activity = activity({ streak: 0, record: 0, streakDays: [], solvedToday: false })
    await renderHome()
    expect(screen.getByTestId('streak-newbie')).toHaveTextContent('Решайте хотя бы одну задачу в день — здесь появится ваша серия')
  })
})
