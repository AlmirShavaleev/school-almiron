import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'

/**
 * §261. Карточка ученика у учителя — настоящий хук `useStudentOverview`, подменён только `supabase.rpc`.
 * Поведение: полный ответ (плитки, таблицы, зоны, активность, «что делать»), ученик без данных, ошибка базы,
 * переключатель предмета, переход к отчёту.
 */
const state = { res: null as { data: unknown; error: unknown } | null, calls: [] as unknown[] }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { state.calls.push([fn, args]); return Promise.resolve(state.res) } },
}))
import { StudentOverview } from '@/components/student/overview/StudentOverview'

const NOW_ISO = '2026-10-03T09:00:00Z'
const ago = (d: number) => new Date(Date.parse(NOW_ISO) - d * 86_400_000).toISOString()
const evidence = (subject: string, ns: number[]) => ns.flatMap(n => [1, 2, 3].map(k => ({
  subject, ns: [n], source: 'hw', score: 1, at: ago(2), item: `hw:${subject}:${n}:${k}`, kim_total: null,
})))
const RULES = {
  window_days: 60, low: 0.4, high: 0.7,
  zones: [{ key: 'growth', per_task: 5, milestones: [] }, { key: 'progress', per_task: 3, milestones: [] }, { key: 'confident', per_task: 1, milestones: [] }],
}

const FULL = {
  today: '2026-10-03', now: NOW_ISO,
  subjects: [
    { subject: 'math', exam_type: 'ege', course_titles: 'Математика ЕГЭ' },
    { subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ 10А' },
  ],
  forecast: {
    now: NOW_ISO, today: '2026-10-03',
    subjects: [{ subject: 'math', goal: null, teacher_goal: null }, { subject: 'physics', goal: 75, teacher_goal: 70 }],
    titles: [],
    numbers: [{ subject: 'physics', n: 4, zone: 'growth', share: 0.3, solved: 0 }, { subject: 'physics', n: 1, zone: 'confident', share: 0.86, solved: 2 }],
    catalog_rules: RULES,
    evidence: [...evidence('physics', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), ...evidence('math', [1])],
  },
  activity: {
    streak: 5, record: 12, solved_today: true, days: ['2026-10-03', '2026-10-01'],
    daily: { days: 14, assigned: 14, done: 6 },
    weekly: [{ subject: 'physics', week_start: '2026-09-28', numbers: [4, 10], target: 10, progress: 7 }],
    catalog: { total: 47, week: { days: 7, tried: 12, correct: 9 } },
  },
  achievements: { total: 79, earned: 23, latest: [] },
  points: { total: 1100, level: { n: 7, name: 'Опыт' }, levels_count: 20 },
  assessments: [
    { title: 'Движение по окружности', subject: 'physics', exam_type: 'ege', kind: 'check', date: '2026-10-03', status: 'accepted', score: 4, grade_scale: 'five', points: 10, points_max: 12, class_avg: 4.0, class_size: 7 },
    { title: 'Кинематика: броски', subject: 'physics', exam_type: 'ege', kind: 'control', date: '2026-09-26', status: 'accepted', score: 4, grade_scale: 'five', points: null, points_max: null, class_avg: 3.9, class_size: 7 },
    { title: 'Логарифмы', subject: 'math', exam_type: 'ege', kind: 'check', date: '2026-09-29', status: 'accepted', score: 3, grade_scale: 'five', points: 5, points_max: 10, class_avg: 3.4, class_size: 20 },
  ],
  homeworks: [
    { title: 'Динамика. Законы Ньютона', subject: 'physics', exam_type: 'ege', due_at: '2026-10-02', first_submitted_at: '2026-10-01T10:00:00Z', status: 'accepted', score: 5, grade_scale: 'five' },
    { title: 'Кинематика. Теория', subject: 'physics', exam_type: 'ege', due_at: '2026-09-22', first_submitted_at: null, status: null, score: null, grade_scale: 'five' },
  ],
  next_steps: { period_from: '2026-09-01', period_to: '2026-10-03', steps: ['№4 и №10 в «зоне роста»: по 10 задач'] },
}

const EMPTY = {
  today: '2026-10-03', now: NOW_ISO,
  subjects: [{ subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ 10В' }],
  forecast: { now: NOW_ISO, today: '2026-10-03', subjects: [{ subject: 'physics', goal: null, teacher_goal: null }], titles: [], numbers: [], catalog_rules: RULES, evidence: [] },
  activity: { streak: 0, record: 0, solved_today: false, days: [], daily: { days: 14, assigned: 0, done: 0 }, weekly: [], catalog: { total: 0, week: { days: 7, tried: 0, correct: 0 } } },
  achievements: { total: 79, earned: 0, latest: [] },
  points: { total: 0, level: { n: 1, name: 'Старт' }, levels_count: 20 },
  assessments: [], homeworks: [], next_steps: null,
}

beforeEach(() => { state.calls = [] })

describe('карточка ученика — «Ученик целиком»', () => {
  it('один вызов базы; шесть плиток; по умолчанию первый предмет ЕГЭ', async () => {
    state.res = { data: FULL, error: null }
    render(<StudentOverview studentId="st-1" onOpenReport={() => {}} />)
    await screen.findByTestId('overview-tiles')
    expect(state.calls).toEqual([['student_overview_for_staff', { p_student_id: 'st-1' }]])
    const tiles = within(screen.getByTestId('overview-tiles'))
    expect(tiles.getByText('Примерный балл ЕГЭ')).toBeInTheDocument()
    expect(tiles.getByText('Каталог')).toBeInTheDocument()
    expect(tiles.getByText('47')).toBeInTheDocument()
    expect(tiles.getByText('5 дн.')).toBeInTheDocument()
    expect(tiles.getByText('рекорд 12 · уровень 7 «Опыт»')).toBeInTheDocument()
    // математика ЕГЭ — первый ЕГЭ-предмет: проверочная «Логарифмы» и баллы «5 из 10»
    expect(screen.getByTestId('overview-subject-math:ege')).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByTestId('overview-assessments')).getByText('5 из 10')).toBeInTheDocument()
    // по математике покрыт один номер — прогноза нет
    expect(within(screen.getByTestId('overview-tile-forecast')).getByText(/мало данных: 1 из 6/)).toBeInTheDocument()
  })

  it('переключатель предмета: физика — прогноз есть, баллы «10 из 12», ДЗ со сроками по §259', async () => {
    state.res = { data: FULL, error: null }
    render(<StudentOverview studentId="st-1" onOpenReport={() => {}} />)
    fireEvent.click(await screen.findByTestId('overview-subject-physics:ege'))
    const forecast = screen.getByTestId('overview-tile-forecast')
    expect(within(forecast).getByText(/^\d+$/)).toBeInTheDocument()
    expect(within(forecast).getByText(/^цель 75/)).toBeInTheDocument()
    const a = within(screen.getByTestId('overview-assessments'))
    expect(a.getByText('10 из 12')).toBeInTheDocument()
    expect(a.getAllByTestId('overview-assessment-row')).toHaveLength(2)
    expect(a.getByText('средняя 4,0')).toBeInTheDocument()
    expect(a.queryByText('Логарифмы')).toBeNull()
    const h = within(screen.getByTestId('overview-homeworks'))
    expect(h.getByText('вовремя')).toBeInTheDocument()
    expect(h.getByText('просрочено 11 дн.')).toBeInTheDocument()
    expect(within(screen.getByTestId('overview-tile-ontime')).getByText('1 / 2')).toBeInTheDocument()
    // зоны номеров части 1 физики: 20 номеров, №1 «уверенно», легенда из порогов базы
    const zones = screen.getAllByTestId('overview-zone')
    expect(zones).toHaveLength(20)
    expect(zones[0]).toHaveAttribute('data-zone', 'confident')
    expect(screen.getByText('от 70 %')).toBeInTheDocument()
  })

  it('активность и награды одной строкой; «что делать» — из отчёта, правка — переходом во вкладку', async () => {
    state.res = { data: FULL, error: null }
    const open = vi.fn()
    render(<StudentOverview studentId="st-1" onOpenReport={open} />)
    const act = within(await screen.findByTestId('overview-activity'))
    expect(act.getByText(/Задача дня: 6 из 14 · цель недели: 7 из 10 · каталог за 7 дней: решено 12, верно 9/)).toBeInTheDocument()
    expect(act.getByText('23 из 79 наград')).toBeInTheDocument()
    expect(act.getByText('дни с решением за 2 недели: 2')).toBeInTheDocument()
    const next = within(screen.getByTestId('overview-next-steps'))
    expect(next.getByText('№4 и №10 в «зоне роста»: по 10 задач')).toBeInTheDocument()
    fireEvent.click(next.getByRole('button', { name: 'Изменить во вкладке «Отчёт»' }))
    expect(open).toHaveBeenCalledTimes(1)
    // одна сводка — без прежних строк «Каталог за 7 дней:» и «Достижения:»
    expect(screen.queryByText(/Каталог за 7 дней:/)).toBeNull()
    expect(screen.queryByText(/Достижения:/)).toBeNull()
  })

  it('ученик без данных — честные пустые состояния, без переключателя предмета', async () => {
    state.res = { data: EMPTY, error: null }
    render(<StudentOverview studentId="st-2" onOpenReport={() => {}} />)
    await screen.findByTestId('overview-tiles')
    expect(screen.queryByRole('group', { name: 'Предмет' })).toBeNull()
    expect(screen.getByText('Проверочных и контрольных пока не было.')).toBeInTheDocument()
    expect(screen.getByText('Домашних заданий со сроком или сдачей пока нет.')).toBeInTheDocument()
    expect(screen.getByText(/Пока не записано/)).toBeInTheDocument()
    expect(within(screen.getByTestId('overview-tile-forecast')).getByText('мало данных: 0 из 10 номеров части 1')).toBeInTheDocument()
    expect(within(screen.getByTestId('overview-tile-assessments')).getByText('—')).toBeInTheDocument()
  })

  it('ошибка базы (нет прав / функции ещё нет) — «Не удалось загрузить» и повтор, без нулей', async () => {
    state.res = { data: null, error: { message: 'ACCESS_DENIED' } }
    render(<StudentOverview studentId="st-1" onOpenReport={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('student-overview-error')).toBeInTheDocument())
    expect(screen.queryByTestId('overview-tiles')).toBeNull()
    state.res = { data: EMPTY, error: null }
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByTestId('overview-tiles')
    expect(state.calls).toHaveLength(2)
  })
})
