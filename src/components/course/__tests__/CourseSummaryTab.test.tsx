import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §264. Вкладка «Сводка» — настоящий хук `useCourseSummary`, подменён только `supabase.rpc`. Поведение: шапка с
 * четырьмя метками, строки учеников (прогноз / «мало данных», оценки, ДЗ k/n, «был»), сортировка нажатием на
 * заголовок, фильтр «просели за неделю», переход в карточку ученика, ошибка базы с повтором.
 */
const state = { res: null as { data: unknown; error: unknown } | null, calls: [] as unknown[] }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { state.calls.push([fn, args]); return Promise.resolve(state.res) } },
}))
import { CourseSummaryTab } from '@/components/course/CourseSummaryTab'

const NOW_ISO = '2026-10-05T09:00:00Z'
const ago = (d: number) => new Date(Date.parse(NOW_ISO) - d * 86_400_000).toISOString()
const P1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const ev = (score: number) => P1.flatMap(n => [1, 2, 3].map(() => [[n], 'hw', score, ago(2), null]))
const fc = (evidence: unknown[], numbers: unknown[] = []) => ({ now: NOW_ISO, subjects: [{ subject: 'physics' }], numbers, ev: evidence })

const DATA = {
  course: { id: 'c-1', title: 'Физика ЕГЭ 10А', subject: 'physics', exam_type: 'ege' },
  now: NOW_ISO, today: '2026-10-05', forecast_enabled: true, titles: [],
  students: [
    {
      student_id: 'st-sh', name: 'Шарипов К.', forecast: fc(ev(1), [{ n: 7, zone: 'progress', share: 0.6 }]),
      assessments: [
        { title: 'П1', date: '2026-09-10', status: 'accepted', score: 5, grade_scale: 'five' },
        { title: 'П2', date: '2026-09-20', status: 'accepted', score: 5, grade_scale: 'five' },
      ],
      homeworks: [{ title: 'Д', due_at: '2026-09-30', first_submitted_at: '2026-09-29T10:00:00Z', status: 'accepted' }],
      catalog: { tried: 25, correct: 21 }, streak: 12, solved_today: true, last_solved: '2026-10-05', last_seen: '2026-10-05',
    },
    {
      student_id: 'st-am', name: 'Аминов А.', forecast: fc([]),
      assessments: [{ title: 'П2', date: '2026-09-20', status: null, grade_scale: 'five' }],
      homeworks: [{ title: 'Д', due_at: '2026-09-30', first_submitted_at: null, status: null }],
      catalog: { tried: 0, correct: 0 }, streak: 0, solved_today: false, last_solved: '2026-09-20', last_seen: '2026-09-23',
    },
    {
      student_id: 'st-ga', name: 'Газизов И.', forecast: fc(ev(0.5), [{ n: 10, zone: 'growth', share: 0.2 }, { n: 4, zone: 'progress', share: 0.5 }]),
      assessments: [{ title: 'П2', date: '2026-09-20', status: 'accepted', score: 4, grade_scale: 'five' }],
      homeworks: [], catalog: { tried: 9, correct: 9 }, streak: 4, solved_today: false, last_solved: '2026-10-04', last_seen: '2026-10-04',
    },
  ],
}

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/course-program?tab=summary']}>
      <Routes>
        <Route path="/course-program" element={<CourseSummaryTab courseId="c-1" />} />
        <Route path="/students/:id" element={<div data-testid="student-card-page">карточка</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const names = () => screen.getAllByTestId('summary-row').map(r => within(r).getByRole('link').textContent)

beforeEach(() => { state.res = { data: DATA, error: null }; state.calls = [] })

describe('CourseSummaryTab', () => {
  it('один вызов на курс; шапка и строки как в макете', async () => {
    renderTab()
    await screen.findByTestId('course-summary-table')
    expect(state.calls).toEqual([['course_summary_for_staff', { p_course_id: 'c-1' }]])
    expect(screen.getByText('Сводка класса · Физика ЕГЭ 10А')).toBeTruthy()
    expect(screen.getByText('3 ученика · за 30 дней')).toBeTruthy()
    expect(screen.getByTestId('summary-chip-homework').textContent).toBe('ДЗ вовремя 50 %')
    expect(screen.getByTestId('summary-chip-assessments').textContent).toBe('проверочные ср. 4,7')
    expect(screen.getByTestId('summary-chip-sagged').textContent).toBe('просели за неделю · 1')
    expect(names()).toEqual(['Аминов А.', 'Газизов И.', 'Шарипов К.'])
    const am = screen.getAllByTestId('summary-row')[0]
    expect(within(am).getByText('мало данных')).toBeTruthy()
    expect(within(am).getByText('не писал')).toBeTruthy()
    expect(within(am).getByText('0 / 1')).toBeTruthy()
    expect(within(am).getByText('12 дней назад')).toBeTruthy()
    expect(within(am).getByTestId('summary-sagged-mark').getAttribute('title')).toBe('за 7 дней ни одной сдачи и решения')
    const ga = screen.getAllByTestId('summary-row')[1]
    expect(within(ga).getAllByTestId('summary-weak').map(w => [w.textContent, w.getAttribute('data-zone')])).toEqual([['10', 'growth'], ['4', 'progress']])
    expect(within(ga).getByText('вчера')).toBeTruthy()
  })

  it('сортировка: нажатие на «Прогноз ЕГЭ» — большие сверху, «мало данных» внизу; второе нажатие — наоборот', async () => {
    renderTab()
    await screen.findByTestId('course-summary-table')
    fireEvent.click(screen.getByTestId('summary-sort-forecast'))
    expect(names()).toEqual(['Шарипов К.', 'Газизов И.', 'Аминов А.'])
    expect(screen.getByTestId('summary-sort-forecast').closest('th')?.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('summary-sort-forecast'))
    expect(names()).toEqual(['Газизов И.', 'Шарипов К.', 'Аминов А.'])
    fireEvent.click(screen.getByTestId('summary-sort-streak'))
    expect(names()).toEqual(['Шарипов К.', 'Газизов И.', 'Аминов А.'])
  })

  it('«просели за неделю» — фильтр строк; повторное нажатие возвращает всех', async () => {
    renderTab()
    await screen.findByTestId('course-summary-table')
    fireEvent.click(screen.getByTestId('summary-chip-sagged'))
    expect(names()).toEqual(['Аминов А.'])
    fireEvent.click(screen.getByTestId('summary-chip-sagged'))
    expect(names()).toHaveLength(3)
  })

  it('клик по строке открывает карточку ученика', async () => {
    renderTab()
    await screen.findByTestId('course-summary-table')
    fireEvent.click(screen.getAllByTestId('summary-row')[2])
    expect(await screen.findByTestId('student-card-page')).toBeTruthy()
  })

  it('курс не ЕГЭ — без колонок прогноза и слабых номеров', async () => {
    state.res = { data: { ...DATA, forecast_enabled: false, students: DATA.students.map(s => ({ ...s, forecast: null })) }, error: null }
    renderTab()
    await screen.findByTestId('course-summary-table')
    expect(screen.queryByTestId('summary-sort-forecast')).toBeNull()
    expect(screen.queryByTestId('summary-sort-weak')).toBeNull()
    expect(screen.queryByTestId('summary-chip-forecast')).toBeNull()
  })

  it('ошибка базы — сообщение и «Повторить» (второй вызов)', async () => {
    state.res = { data: null, error: { message: 'ACCESS_DENIED' } }
    renderTab()
    expect(await screen.findByTestId('course-summary-error')).toBeTruthy()
    state.res = { data: DATA, error: null }
    fireEvent.click(screen.getByText('Повторить'))
    await waitFor(() => expect(screen.getByTestId('course-summary-table')).toBeTruthy())
    expect(state.calls).toHaveLength(2)
  })
})
