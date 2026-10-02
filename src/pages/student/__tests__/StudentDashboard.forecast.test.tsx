import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildStudentTodo } from '@/lib/studentTodo'
import type { HomeActivity } from '@/lib/studentHome'

/**
 * §255. Главная ученика, этап 2: «Примерный балл на ЕГЭ», «Баллы школы» и
 * плашка «N дней до ЕГЭ». Хуки §255 НАСТОЯЩИЕ (`useExamForecast`,
 * `useSchoolPoints`) — подменён только вызов базы `supabase.rpc`, так что
 * проверяется весь стык «ответ базы → модель → экран».
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
const MATH_OGE = { courseId: 'c-o', groupId: 'g-o', courseTitle: 'Математика ОГЭ', subject: 'math', examType: 'oge' }

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
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return r
}

beforeEach(() => {
  state.courses = [PHYS_EGE, MATH_EGE]
  state.activity = activity('2026-10-02')
  state.forecast = forecastResponse()
  state.forecastError = null
  state.points = POINTS
  state.rpcCalls = []
})

describe('главная §255: примерный балл на ЕГЭ', () => {
  it('математика: балл из 100, диапазон, шкала с порогом и целью, плитки КИМ, «Решите в каталоге», источники', async () => {
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    // карточка — первой в левой колонке
    expect(card.parentElement?.getAttribute('data-slot')).toBe('left')
    expect(card.parentElement?.firstElementChild).toBe(card)
    expect(within(card).getByTestId('forecast-subject-math')).toHaveAttribute('aria-pressed', 'true')
    const score = Number(within(card).getByTestId('forecast-score').textContent)
    expect(score).toBeGreaterThan(27)
    expect(score).toBeLessThan(100)
    const range = within(card).getByTestId('forecast-range').textContent!
    const [, lo, hi] = range.match(/от (\d+) до (\d+)/)!.map(Number)
    expect(lo).toBeLessThanOrEqual(score)
    expect(hi).toBeGreaterThanOrEqual(score)
    expect(within(card).getByText('по шкале ЕГЭ-2026')).toBeInTheDocument()
    const scale = within(card).getByTestId('forecast-scale')
    expect(scale.querySelector('[data-tick=min]')).toHaveTextContent('порог 27')
    expect(scale.querySelector('[data-tick=goal]')).toHaveTextContent('цель 80')
    // плитки: 12 + 7, №6 — нижняя ступень, №15 (не решали) — штриховка
    expect(within(card).getByTestId('kim-part1').querySelectorAll('button')).toHaveLength(12)
    expect(within(card).getByTestId('kim-part2').querySelectorAll('button')).toHaveLength(7)
    expect(card.querySelector('[data-n="6"]')).toHaveAttribute('data-level', '1')
    expect(card.querySelector('[data-n="15"]')).toHaveAttribute('data-level', '0')
    expect(card.querySelector('[data-n="6"]')).toHaveAttribute('aria-label', '№6: верно 25 % решений (4 задачи) · Простейшие уравнения')
    // §256: вместо «быстрее всего добавят» — «Решите в каталоге — и балл вырастет»:
    // номера НЕ «уверенно», с разделом каталога; первым — слабый №6 (больше всех прирост
    // за 10 верных — та же модель), «верно k из 10» — засчитанное до следующей вехи;
    // «уверенно» (№2, №7) — тихой строкой без кнопки.
    const cat = within(card).getByTestId('forecast-catalog')
    expect(cat).toHaveTextContent('Решите в каталоге — и балл вырастет')
    const rows = cat.querySelectorAll('li')
    // №3 и №4 решаются одинаково — прирост равный, порядок по номеру
    expect([...rows].map(li => li.getAttribute('data-n'))).toEqual(['6', '3', '4'])
    expect(rows[0]).toHaveTextContent('Простейшие уравнения')
    expect(rows[0]).toHaveTextContent('верно 3 из 10')
    expect(rows[0]).toHaveTextContent(/≈ \+\d+ к прогнозу/)
    expect(rows[0]).toHaveTextContent('за 10 верных')
    expect(rows[1]).toHaveTextContent('верно 12 из 20')
    expect(rows[2]).toHaveTextContent('верно 0 из 10')
    expect(within(cat).getByTestId('forecast-catalog-go-6')).toHaveAttribute('href', '/catalog/sec-6?subject=math&exam=ege')
    expect(within(cat).getByTestId('forecast-catalog-confident')).toHaveTextContent('Уже уверенно: №2, №7 — там ≈ +1, почти максимум')
    expect(within(cat).queryByTestId('forecast-catalog-go-7')).toBeNull()
    expect(within(card).getByTestId('forecast-sources')).toHaveTextContent('ДЗ · 49 задач')
    expect(within(card).getByTestId('forecast-sources')).toHaveTextContent('каталог · 1')
    expect(within(card).getByTestId('forecast-sources')).toHaveTextContent('пробник · 1')
  })

  it('подсказка плитки — при наведении и при фокусе', async () => {
    await renderHome()
    const tile = (await screen.findByTestId('forecast-card')).querySelector('[data-n="6"]') as HTMLElement
    fireEvent.focus(tile)
    expect(screen.getByTestId('home-tip')).toHaveTextContent('№6: верно 25 % решений (4 задачи)')
    fireEvent.blur(tile)
    expect(screen.queryByTestId('home-tip')).toBeNull()
  })

  it('переключение на физику: данных мало — «Решите ещё N задач…» и полоса покрытия, балла нет', async () => {
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    fireEvent.click(within(card).getByTestId('forecast-subject-physics'))
    expect(within(card).getByTestId('forecast-subject-physics')).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).queryByTestId('forecast-score')).toBeNull()
    const missing = within(card).getByTestId('forecast-missing')
    expect(missing).toHaveTextContent('Решите ещё 7 задач из разных номеров — и мы покажем примерный балл')
    expect(within(missing).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(within(missing).getByRole('progressbar')).toHaveAttribute('aria-valuemax', '10')
    expect(within(card).getByTestId('kim-part1').querySelectorAll('button')).toHaveLength(20)
    expect(within(card).getByText('Поставить цель')).toBeInTheDocument()
  })

  it('ввод цели: 1..100 проверяется до базы; сохранение — set_my_exam_goal, отметка на шкале', async () => {
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    fireEvent.click(within(card).getByTestId('forecast-goal-edit'))
    const input = within(card).getByTestId('forecast-goal-input') as HTMLInputElement
    expect(input.value).toBe('80')
    expect(within(card).getByText(/учитель предлагает 70/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '120' } })
    fireEvent.submit(within(card).getByTestId('forecast-goal-form'))
    expect(within(card).getByRole('alert')).toHaveTextContent('Цель — целое число от 1 до 100')
    expect(state.rpcCalls.some(([fn]) => fn === 'set_my_exam_goal')).toBe(false)

    fireEvent.change(input, { target: { value: '85' } })
    await act(async () => { fireEvent.submit(within(card).getByTestId('forecast-goal-form')) })
    expect(state.rpcCalls).toContainEqual(['set_my_exam_goal', { p_subject: 'math', p_goal: 85 }])
    await waitFor(() => expect(within(card).queryByTestId('forecast-goal-form')).toBeNull())
    expect(within(card).getByTestId('forecast-scale').querySelector('[data-tick=goal]')).toHaveTextContent('цель 85')
    expect(within(card).getByTestId('forecast-goal-edit')).toHaveTextContent('Цель 85 · изменить')
  })

  it('ошибка базы при сохранении цели — текст ошибки, форма остаётся', async () => {
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    fireEvent.click(within(card).getByTestId('forecast-goal-edit'))
    fireEvent.change(within(card).getByTestId('forecast-goal-input'), { target: { value: '13' } })
    await act(async () => { fireEvent.submit(within(card).getByTestId('forecast-goal-form')) })
    expect(within(card).getByRole('alert')).toHaveTextContent('только по предмету своего курса ЕГЭ')
    expect(within(card).getByTestId('forecast-goal-form')).toBeInTheDocument()
  })

  it('убрать цель — p_goal null, отметки на шкале нет', async () => {
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    fireEvent.click(within(card).getByTestId('forecast-goal-edit'))
    await act(async () => { fireEvent.click(within(card).getByTestId('forecast-goal-clear')) })
    expect(state.rpcCalls).toContainEqual(['set_my_exam_goal', { p_subject: 'math', p_goal: null }])
    await waitFor(() => expect(within(card).getByTestId('forecast-scale').querySelector('[data-tick=goal]')).toBeNull())
  })

  it('один предмет — без переключателя', async () => {
    state.courses = [MATH_EGE]
    state.forecast = forecastResponse({ subjects: [{ subject: 'math', goal: null, teacher_goal: null }] })
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    expect(within(card).queryByRole('group', { name: 'Предмет' })).toBeNull()
  })

  it('только ОГЭ — карточки прогноза нет и база не спрашивается', async () => {
    state.courses = [MATH_OGE]
    await renderHome()
    expect(screen.queryByTestId('forecast-card')).toBeNull()
    expect(state.rpcCalls.some(([fn]) => fn === 'student_exam_forecast_evidence')).toBe(false)
  })

  it('функции ещё нет (миграция не применена) — строка «Не удалось загрузить прогноз», главная живёт', async () => {
    state.forecastError = 'Could not find the function public.student_exam_forecast_evidence'
    await renderHome()
    const card = await screen.findByTestId('forecast-card')
    expect(card).toHaveTextContent('Не удалось загрузить прогноз.')
    expect(screen.getByTestId('points-card')).toBeInTheDocument()
  })
})

describe('главная §255: баллы школы', () => {
  // §257: пять значков §255 (в т. ч. «Прогноз +5» с клиента) сняты — их место заняли
  // последние награды «Достижений» (StudentDashboard.achievements257.test.tsx).
  it('под «Серией»: сумма, уровень, лента; значков §255 больше нет — ссылка «Все достижения»', async () => {
    await renderHome()
    const card = await screen.findByTestId('points-card')
    expect(card.parentElement?.getAttribute('data-slot')).toBe('right')
    expect(card.previousElementSibling).toBe(screen.getByTestId('streak-card'))
    expect(within(card).getByTestId('points-total')).toHaveTextContent('340')
    expect(within(card).getByTestId('points-level')).toHaveTextContent('уровень 4 «Упорство»')
    expect(card).toHaveTextContent('до 5-го уровня — 110 баллов')
    expect(within(card).getByTestId('points-feed')).toHaveTextContent('ДЗ «Динамика» сдано вовремя')
    expect(within(card).queryByTestId('points-badges')).toBeNull()
    expect(card.querySelector('[data-badge]')).toBeNull()
    expect(within(card).getByTestId('points-all-achievements')).toHaveAttribute('href', '/achievements')
  })

  it('рейтинга нет: ни имён, ни мест — только свои баллы', async () => {
    await renderHome()
    const card = await screen.findByTestId('points-card')
    expect(card).not.toHaveTextContent(/место|рейтинг класса:/i)
    expect(card).toHaveTextContent('Баллы видите только вы')
  })
})

describe('главная §255: дни до ЕГЭ', () => {
  it('«242 дня до ЕГЭ · примерно, до 1 июня» слева от серии; день — от сервера', async () => {
    state.activity = activity('2026-10-02')
    await renderHome()
    const pill = screen.getByTestId('exam-countdown')
    expect(pill).toHaveTextContent('242')
    expect(pill).toHaveTextContent('дня до ЕГЭ')
    expect(pill).toHaveTextContent('примерно, до 1 июня')
    expect(pill).toHaveAttribute('title', 'Основной период ЕГЭ — конец мая – начало июня. Точная дата появится в расписании.')
    expect(pill.nextElementSibling).toBe(screen.getByTestId('streak-pill'))
  })

  it('только ОГЭ — «до ОГЭ»; без экзаменационных курсов — плашки нет; после даты — нет', async () => {
    state.courses = [MATH_OGE]
    const { unmount } = await renderHome()
    expect(screen.getByTestId('exam-countdown')).toHaveTextContent('дня до ОГЭ')
    unmount()
    state.courses = [{ ...MATH_OGE, examType: null }]
    const r2 = await renderHome()
    expect(screen.queryByTestId('exam-countdown')).toBeNull()
    r2.unmount()
    state.courses = [MATH_EGE]
    state.activity = activity('2027-06-01')
    await renderHome()
    expect(screen.queryByTestId('exam-countdown')).toBeNull()
  })
})
