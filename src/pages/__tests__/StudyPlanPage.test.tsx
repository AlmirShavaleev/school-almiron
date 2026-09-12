import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { decodeBoard, type StudyPlanBoard } from '@/lib/studyPlanBoard'

const actions = {
  savePlan: vi.fn().mockResolvedValue(undefined),
  spread: vi.fn().mockResolvedValue(169),
  setTopicWeek: vi.fn().mockResolvedValue(undefined),
  setOverride: vi.fn().mockResolvedValue(undefined),
}
let boardState: { board: StudyPlanBoard | null; loading: boolean; error: string | null }

vi.mock('@/hooks/useStudyPlanBoard', () => ({
  useStudyPlanBoard: () => ({ ...boardState, busy: false, reload: vi.fn(), actions }),
}))
vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => ({ readOnly: false, active: false, loading: false, teacherId: null, courseIds: [], groupIds: [], ownStudentId: null }),
}))
vi.mock('@/store/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), saved: vi.fn() },
}))

import { StudyPlanPage } from '@/pages/StudyPlanPage'

/** Фикстура — срез прода на 12.09: два ученика, три темы, две недели. */
const RAW = {
  plan: { start_date: '2026-09-07', auto_open: true, current_week: 1, weeks_total: 2 },
  students: [
    { student_id: 's-a', profile_id: 'p-a', full_name: 'Аминов' },
    { student_id: 's-b', profile_id: 'p-b', full_name: 'Борисов' },
  ],
  topics: [
    { topic_id: 't-1', title: 'Кинематика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-2', title: 'Динамика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-3', title: 'Статика', module_title: 'Механика', week_no: 2, is_open: null, available_from: '2026-09-14', open_now: false },
  ],
  cells: [
    [0, 0, 1, 3, 2, 2, 1 + 2 + 64, '2026-09-08T10:00:00+00:00'],
    [0, 1, 1, 1, 2, 2, 2 + 64],
    [0, 2, 2, 0, 2, 0, 0],
    [1, 0, 1, 1, 2, 0, 4 + 64],
    [1, 1, 1, 0, 2, 2, 1],
    [1, 2, 2, 0, 1, 0, 0],
  ],
  summary: [[0, 1, 2, 1, 0], [0, 2, 1, 0, 0], [1, 1, 2, 1, 1], [1, 2, 1, 0, 0]],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/course-program/course-1/plan']}>
      <Routes>
        <Route path="/course-program/:courseId/plan" element={<StudyPlanPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudyPlanPage', () => {
  beforeEach(() => {
    boardState = { board: decodeBoard(RAW), loading: false, error: null }
    actions.spread.mockClear()
    actions.savePlan.mockClear()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('без прав — доска null — говорит словами, а не пустым экраном', () => {
    boardState = { board: null, loading: false, error: null }
    renderPage()
    expect(screen.getByText('Нет доступа к плану этого курса')).toBeInTheDocument()
  })

  it('перекладка спрашивает подтверждение прямыми словами и сохраняет отклонения', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('plan-per-week'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('plan-spread'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Текущая раскладка будет заменена'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Отклонения по ученикам'))
    await waitFor(() => expect(actions.spread).toHaveBeenCalledWith(3))
  })

  it('отказ в подтверждении — перекладки нет', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    fireEvent.click(screen.getByTestId('plan-spread'))
    expect(actions.spread).not.toHaveBeenCalled()
  })

  it('таблица: ученики строками, недели столбцами, клетка — зачтено из всего', () => {
    renderPage()
    const cells = screen.getAllByTestId('plan-cell')
    expect(cells).toHaveLength(4)
    const a1 = cells.find(c => c.dataset.student === '0' && c.dataset.week === '1')!
    expect(a1).toHaveTextContent('1/2')
    const b1 = cells.find(c => c.dataset.student === '1' && c.dataset.week === '1')!
    expect(b1.getAttribute('title')).toContain('просрочено 1')
  })

  it('отчёт по неделе: полностью / частично / не начали — поимённо, имена ведут на карточку', () => {
    renderPage()
    expect(screen.getByTestId('week-report')).toHaveTextContent('частично: 2')
    expect(screen.getByTestId('week-report')).toHaveTextContent('не начали: 0')
    fireEvent.change(screen.getByTestId('week-report-select'), { target: { value: '2' } })
    expect(screen.getByTestId('report-none')).toHaveTextContent('Аминов')
    expect(screen.getByTestId('report-none').querySelector('a')).toHaveAttribute('href', '/students/s-a')
    expect(screen.getByTestId('report-none')).toHaveTextContent('Борисов')
    expect(screen.getByTestId('week-report')).toHaveTextContent('не начали: 2')
  })

  it('клик по клетке открывает темы ученика с расхождением «отметил, не сдал»', () => {
    renderPage()
    const cells = screen.getAllByTestId('plan-cell')
    fireEvent.click(cells.find(c => c.dataset.student === '0' && c.dataset.week === '1')!)
    const detail = screen.getByTestId('student-week-detail')
    expect(detail).toHaveTextContent('Аминов')
    const rows = screen.getAllByTestId('detail-topic')
    expect(rows[1]).toHaveTextContent('Динамика')
    expect(rows[1]).toHaveTextContent('отмечено пройденным · ДЗ не сдано')
  })

  it('дата старта не в понедельник не сохраняется', async () => {
    renderPage()
    fireEvent.change(screen.getByTestId('plan-start-date'), { target: { value: '2026-09-09' } })
    expect(screen.getByText('Нужен понедельник')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('plan-start-date'), { target: { value: '2026-09-14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(actions.savePlan).toHaveBeenCalledWith('2026-09-14', true))
  })
})
