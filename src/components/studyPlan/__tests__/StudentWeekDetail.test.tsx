import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentWeekDetail } from '@/components/studyPlan/StudentWeekDetail'
import { decodeBoard } from '@/lib/studyPlanBoard'

vi.mock('@/store/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), saved: vi.fn() },
}))

/**
 * Приёмка §151: в клетке видно расхождение «отметил пройденной, но ДЗ не
 * сдал», а тема без опубликованного ДЗ не выглядит как «ученик не сделал».
 */
const board = decodeBoard({
  plan: { start_date: '2026-09-07', auto_open: true, current_week: 1, weeks_total: 2 },
  students: [{ student_id: 's-a', profile_id: 'p-a', full_name: 'Аминов Амирхан' }],
  topics: [
    { topic_id: 't-1', title: 'Кинематика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-2', title: 'Динамика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-3', title: 'Статика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
  ],
  cells: [
    [0, 0, 1, 1, 2, 2, 2 + 64],   // отметил пройденным, ДЗ не сдал
    [0, 1, 1, 0, 2, 0, 0],        // ДЗ не опубликовано, не пройдено
    [0, 2, 1, 3, 2, 0, 1 + 64, '2026-09-09T10:00:00+00:00'], // сдано
  ],
  summary: [[0, 1, 3, 1, 0]],
})

function renderIt(onSetOverride = vi.fn().mockResolvedValue(undefined), canEdit = true) {
  render(
    <MemoryRouter>
      <StudentWeekDetail
        board={board} si={0} week={1} weeks={[1, 2]} canEdit={canEdit} busy={false}
        onClose={vi.fn()} onSetOverride={onSetOverride}
      />
    </MemoryRouter>,
  )
  return screen.getAllByTestId('detail-topic')
}

describe('StudentWeekDetail — клетка ученика', () => {
  it('расхождение «отметил, но не сдал» показано рядом с зачётом', () => {
    const [row] = renderIt()
    expect(row).toHaveTextContent('ДЗ не сдано')
    expect(row.querySelector('[data-testid="detail-marks"]')).toHaveTextContent('отмечено пройденным · ДЗ не сдано')
  })

  it('тема без опубликованного ДЗ не выглядит как «не сдал»', () => {
    const rows = renderIt()
    const row = rows[1]
    expect(row).toHaveTextContent('ещё не пройдено')
    expect(row.querySelector('[data-testid="detail-basis"]')).toHaveTextContent('зачёт по отметке · ДЗ не опубликовано')
    expect(row).not.toHaveTextContent('ДЗ не сдано')
  })

  it('сданная тема — зачёт и дата сдачи', () => {
    const rows = renderIt()
    expect(rows[2].querySelector('[data-testid="detail-state"]')).toHaveTextContent('ДЗ сдано 9 сен')
  })

  it('имя ведёт на карточку ученика по student_id, а не profile_id', () => {
    renderIt()
    expect(screen.getByRole('link', { name: 'Аминов Амирхан' })).toHaveAttribute('href', '/students/s-a')
  })

  it('отклонения: сдвиг срока и снятие темы уходят в RPC с нужными аргументами', async () => {
    const onSetOverride = vi.fn().mockResolvedValue(undefined)
    const rows = renderIt(onSetOverride)
    const select = rows[0].querySelector('select')!
    fireEvent.change(select, { target: { value: '2' } })
    await waitFor(() => expect(onSetOverride).toHaveBeenCalledWith('s-a', 't-1', { week: 2 }))
    fireEvent.change(select, { target: { value: 'remove' } })
    await waitFor(() => expect(onSetOverride).toHaveBeenCalledWith('s-a', 't-1', { removed: true }))
    fireEvent.change(select, { target: { value: 'reset' } })
    await waitFor(() => expect(onSetOverride).toHaveBeenCalledWith('s-a', 't-1', null))
  })

  it('куратору отклонения недоступны — только чтение', () => {
    const rows = renderIt(vi.fn(), false)
    expect(rows[0].querySelector('select')).toBeNull()
  })
})
