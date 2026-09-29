import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const rpcSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => rpcSpy(fn, args) } }))
vi.mock('@/hooks/useMyTeachingScope', () => ({ useMyTeachingScope: () => ({ readOnly: false }) }))

import { CourseStatsSection } from '@/components/courseProgram/CourseStatsSection'
import type { Module } from '@/hooks/useCourseProgram'

const TODAY = '2026-09-29'
const modules: Module[] = [{
  id: 'm1', course_id: 'c1', title: 'Механика', order_index: 1, topics: [
    { id: 't1', module_id: 'm1', title: 'Кинематика', order_index: 1, max_score: 100, available_from: null, is_open: true },
    { id: 't2', module_id: 'm1', title: 'Динамика', order_index: 2, max_score: 100, available_from: null, is_open: true },
  ],
}]

const summary = (period: string, over: Record<string, unknown> = {}) => ({
  period, from: null, to: TODAY, in_class: 4, active: period === '7d' ? 3 : 4, views: period === '7d' ? 5 : 8,
  views_prev: period === 'all' ? null : 2, video_seconds: 12000, video_done: 2, submitted: 3, accepted: 2, returned: 0,
  pending: 1, pending_oldest_at: '2026-09-27T09:00:00Z', avg_five: 4.25, avg_five_count: 2, avg_hundred: null, avg_hundred_count: 0,
  days: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, active: i % 4 })),
  quiet: [{ student_id: 's4', full_name: 'Четвёртый Ученик', last_day: null }], no_hw_14: [],
  ...over,
})
const topics = (period: string) => ({
  period, in_class: 4, topics: [
    { topic_id: 't1', timed: false, opened: 2, videos: 1, video_done: 1, video_started: 1, hw: true, grade_scale: 'five', submitted: 2, avg_score: 5, pending: 1 },
    { topic_id: 't2', timed: false, opened: 1, videos: 0, video_done: 0, video_started: 0, hw: false, grade_scale: null, submitted: 0, avg_score: null, pending: 0 },
  ],
})
const students = {
  period: '7d', to: TODAY, in_class: 3, mock: { id: 'mx', title: 'Пробник №2', max_score: 100 },
  rows: [
    { student_id: 's1', full_name: 'Первый Ученик', last_day: TODAY, days: 3, files_opened: 4, files_total: 5, video_seconds: 900, hw7: 1, hw30: 2, hw_done: 2, hw_total: 2, avg_five: 5, avg_hundred: null, debts: 0, mock_score: 70 },
    { student_id: 's3', full_name: 'Третий Ученик', last_day: '2026-09-25', days: 1, files_opened: 1, files_total: 3, video_seconds: 0, hw7: 0, hw30: 0, hw_done: 0, hw_total: 2, avg_five: null, avg_hundred: null, debts: 1, mock_score: null },
    { student_id: 's4', full_name: 'Четвёртый Ученик', last_day: null, days: 0, files_opened: 0, files_total: 3, video_seconds: 0, hw7: 0, hw30: 0, hw_done: 0, hw_total: 2, avg_five: null, avg_hundred: null, debts: 1, mock_score: null },
  ],
}
const topicStudents = { topic_id: 't1', videos: 1, rows: [
  { student_id: 's1', full_name: 'Первый Ученик', opened: true, video: 'done', hw_status: 'accepted', score: 5, grade_scale: 'five' },
  { student_id: 's2', full_name: 'Второй Ученик', opened: true, video: 'started', hw_status: 'submitted', score: null, grade_scale: 'five' },
  { student_id: 's3', full_name: 'Третий Ученик', opened: false, video: 'none', hw_status: null, score: null, grade_scale: null },
] }

function okRpc(fn: string, args: { p_period: string }) {
  if (fn === 'course_stats_summary') return Promise.resolve({ data: summary(args.p_period), error: null })
  if (fn === 'course_stats_topics') return Promise.resolve({ data: topics(args.p_period), error: null })
  if (fn === 'course_stats_students') return Promise.resolve({ data: { ...students, period: args.p_period }, error: null })
  if (fn === 'course_stats_topic_students') return Promise.resolve({ data: topicStudents, error: null })
  return Promise.resolve({ data: null, error: { message: 'нет' } })
}

function renderSection(props: Partial<Parameters<typeof CourseStatsSection>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/course-program']}>
      <Routes>
        <Route path="/course-program" element={(
          <CourseStatsSection
            courseId="c1"
            isTemplate={false}
            modules={modules}
            legacyHw={{}}
            homeworkStateByTopic={{}}
            onOpenTopic={vi.fn()}
            onOpenHomeworkTab={vi.fn()}
            onToggleTopicOpen={vi.fn()}
            fallback={<div data-testid="legacy-table">Шаблоны · Назначения</div>}
            {...props}
          />
        )} />
        <Route path="/students/:id" element={<div data-testid="student-card">карточка</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const calls = (fn: string) => rpcSpy.mock.calls.filter(c => c[0] === fn).map(c => c[1])

describe('CourseStatsSection (§242)', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    rpcSpy.mockImplementation(okRpc)
    localStorage.clear()
  })

  it('сводка за 7 дней: плитки, разница к прошлой неделе, кто не заходил', async () => {
    renderSection()
    const panel = await screen.findByTestId('course-stats')
    expect(within(panel).getByText(/Статистика курса · 4 ученика/)).toBeInTheDocument()
    expect(within(screen.getByTestId('stats-tile-active')).getByText('3')).toBeInTheDocument()
    expect(screen.getByTestId('stats-tile-views')).toHaveTextContent('5раз · +3 к прошлой неделе')
    expect(screen.getByTestId('stats-tile-video')).toHaveTextContent('3 ч 20 м')
    expect(screen.getByTestId('stats-tile-video')).toHaveTextContent('досмотрено 2 ролика')
    expect(screen.getByTestId('stats-tile-pending')).toHaveTextContent('самая старая — 2 дня')
    expect(screen.getByTestId('stats-tile-avg')).toHaveTextContent('4,3')
    expect(screen.getByTestId('stats-quiet-list')).toHaveTextContent('Четвёртый У.')
    expect(screen.getAllByTestId('activity-bar')).toHaveLength(30)
    // Две RPC на экран: сводка и таблица текущего разреза.
    expect(calls('course_stats_summary')).toEqual([{ p_course_id: 'c1', p_period: '7d' }])
    expect(calls('course_stats_topics')).toEqual([{ p_course_id: 'c1', p_period: '7d' }])
    expect(calls('course_stats_students')).toEqual([])
  })

  it('период: «Всё время» перезапрашивает, пишет «считаем с 13 августа» и запоминается', async () => {
    renderSection()
    await screen.findByTestId('course-stats')
    fireEvent.click(within(screen.getByTestId('stats-period')).getByRole('button', { name: 'Всё время' }))
    await waitFor(() => expect(screen.getByTestId('course-stats')).toHaveAttribute('data-period', 'all'))
    expect(screen.getByTestId('stats-tile-views')).toHaveTextContent('считаем с 13 августа')
    expect(screen.getByTestId('stats-tile-video')).toHaveTextContent('с 18 сентября')
    expect(calls('course_stats_topics').at(-1)).toEqual({ p_course_id: 'c1', p_period: 'all' })
    expect(localStorage.getItem('course-stats:period')).toBe('all')
  })

  it('запомненный период читается при открытии', async () => {
    localStorage.setItem('course-stats:period', '30d')
    renderSection()
    await screen.findByTestId('course-stats')
    expect(calls('course_stats_summary')[0]).toEqual({ p_course_id: 'c1', p_period: '30d' })
    expect(within(screen.getByTestId('stats-period')).getByRole('button', { name: '30 дней' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('по темам: новые столбцы и раскрытие темы по ученикам', async () => {
    renderSection()
    const rows = await screen.findAllByTestId('stats-topic-row')
    await waitFor(() => expect(within(rows[0]).getByTestId('stat-opened')).toHaveAttribute('data-value', '2/4'))
    expect(within(rows[0]).getByTestId('stat-video')).toHaveAttribute('data-value', '1/4')
    expect(within(rows[0]).getByTestId('stat-hw')).toHaveAttribute('data-value', '2/4')
    expect(within(rows[0]).getByTestId('stat-avg')).toHaveTextContent('5,0')
    expect(within(rows[0]).getByTestId('stat-pending')).toHaveTextContent('1')
    expect(rows[1]).toHaveTextContent('нет видео')
    expect(rows[1]).toHaveTextContent('нет ДЗ')
    expect(screen.queryByText(/Шаблоны|Назначения|Последнее назначение/)).not.toBeInTheDocument()

    expect(screen.queryByTestId('stats-topic-detail')).not.toBeInTheDocument()
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Кто из учеников открыл/ }))
    const people = await screen.findAllByTestId('stats-topic-student')
    expect(calls('course_stats_topic_students')).toEqual([{ p_course_id: 'c1', p_topic_id: 't1', p_period: '7d' }])
    expect(people).toHaveLength(3)
    expect(people[0]).toHaveTextContent('Первый У.')
    expect(within(people[0]).getByLabelText('Оценка за ДЗ: 5')).toBeInTheDocument()
    expect(within(people[1]).getByLabelText('Начал видео, не досмотрел')).toBeInTheDocument()
    expect(within(people[1]).getByLabelText('ДЗ сдано, ждёт проверки')).toBeInTheDocument()
    expect(within(people[2]).getByLabelText('Материалы темы не открывал')).toBeInTheDocument()
    // Клик по строке ещё раз сворачивает.
    fireEvent.click(rows[0])
    expect(screen.queryByTestId('stats-topic-detail')).not.toBeInTheDocument()
  })

  it('по ученикам: сначала дольше всех не заходившие, сортировка по столбцу, переход в карточку', async () => {
    renderSection()
    await screen.findByTestId('course-stats')
    fireEvent.click(within(screen.getByTestId('stats-view')).getByRole('button', { name: 'По ученикам' }))
    const table = await screen.findByTestId('stats-students')
    const order = () => within(table).getAllByTestId('stats-student-row').map(r => r.getAttribute('data-student'))
    expect(order()).toEqual(['s4', 's3', 's1'])
    const last = within(table).getAllByTestId('stat-last').map(c => c.textContent)
    expect(last).toEqual(['не заходил', '4 дня назад', 'сегодня'])
    expect(within(table).getAllByTestId('stat-files')[2]).toHaveTextContent('4 из 5')
    expect(table).toHaveTextContent('не писал')
    expect(localStorage.getItem('course-stats:view')).toBe('students')

    fireEvent.click(within(table).getByRole('button', { name: 'Долги' }))
    expect(order()).toEqual(['s3', 's4', 's1'])
    expect(within(table).getByRole('button', { name: /Долги/ }).closest('th')).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(within(table).getByRole('button', { name: /Долги/ }))
    expect(order()[0]).toBe('s1')

    fireEvent.click(within(table).getAllByTestId('stats-student-row')[0])
    expect(await screen.findByTestId('student-card')).toBeInTheDocument()
  })

  it('«Показать в таблице учеников» переключает разрез', async () => {
    renderSection()
    await screen.findByTestId('course-stats')
    fireEvent.click(screen.getByRole('button', { name: /Показать в таблице учеников/ }))
    expect(await screen.findByTestId('stats-students')).toBeInTheDocument()
  })

  it('каркас курса: без панели, без столбцов статистики и без запросов', () => {
    renderSection({ isTemplate: true })
    expect(screen.getByText(/статистика учеников — в классах/)).toBeInTheDocument()
    expect(screen.queryByTestId('course-stats')).not.toBeInTheDocument()
    expect(screen.queryByText('Открыли')).not.toBeInTheDocument()
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('в классе нет учеников — пометка вместо панели и пустых столбцов', async () => {
    rpcSpy.mockImplementation((fn: string, args: { p_period: string }) => fn === 'course_stats_summary'
      ? Promise.resolve({ data: summary(args.p_period, { in_class: 0, active: 0 }), error: null })
      : okRpc(fn, args))
    renderSection()
    expect(await screen.findByTestId('course-stats-empty')).toHaveTextContent('В классе пока нет учеников')
    expect(screen.queryByTestId('course-stats')).not.toBeInTheDocument()
    expect(screen.queryByText('Видео досмотрели')).not.toBeInTheDocument()
  })

  it('без миграции (ошибка RPC) — прежняя таблица', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.course_stats_summary' } })
    renderSection()
    expect(await screen.findByTestId('legacy-table')).toBeInTheDocument()
    expect(screen.queryByTestId('course-stats')).not.toBeInTheDocument()
  })
})
