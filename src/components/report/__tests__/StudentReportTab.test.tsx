import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StudentReportTab } from '@/components/report/StudentReportTab'
import type { ProgressReport } from '@/lib/parentReport'

/**
 * §217. Экран отчёта в кабинете.
 *
 * Разница между экраном и листом ровно одна: внутренняя заметка
 * преподавателя. На экране она есть, в печатном портале — нет ни одним
 * узлом.
 */

const SECRET = 'ВНУТРЕННЯЯ ЗАМЕТКА: бросает задачу на середине.'

const report: ProgressReport = {
  student: { id: 'st-1', full_name: 'Нурмухаметова Алина', grade: 11, groups: ['11А'] },
  period: { from: '2026-09-01', to: '2026-09-25' },
  generated_at: '2026-09-25T10:00:00+00:00',
  min_group_for_avg: 6,
  min_tasks_for_topic: 3,
  subjects: [{
    subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ',
    target: 75, avg_percent: 62, graded_works: 7,
    group_size: 9, group_avg_percent: 58,
    works: { submitted: 9, accepted: 7, revision: 1, pending: 1, with_due: 9, on_time: 7, late: 2 },
    weeks: [{ week_start: '2026-09-01', avg_percent: 62, works: 7 }],
    last_mock: null,
  }],
  mocks: [],
  topics: { weak: [], strong: [], without_number: 0 },
  ege_numbers: [],
  activity: { video_seconds: 0, video_seconds_last_week: 0, materials: 0, catalog_tasks: 0, with_due: 9, on_time: 7, late: 2 },
  next_steps: ['Разобрать термодинамику'],
  teacher_note: { body: SECRET, created_at: '2026-09-20T10:00:00+00:00' },
}

const reportMock = vi.fn()
const saveMock = vi.fn()

vi.mock('@/hooks/useStudentProgressReport', () => ({
  useStudentProgressReport: (...args: unknown[]) => reportMock(...args),
}))
vi.mock('@/hooks/useReportNextSteps', () => ({
  useReportNextSteps: () => ({ save: saveMock, saving: false }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-teacher', role: 'teacher' } }),
}))

beforeEach(() => {
  reportMock.mockReset()
  saveMock.mockReset()
  saveMock.mockResolvedValue(undefined)
  reportMock.mockReturnValue({ report, loading: false, error: null, reload: vi.fn() })
})

describe('вкладка отчёта в карточке ученика', () => {
  it('внутренняя заметка видна на экране', () => {
    render(<StudentReportTab studentId="st-1" />)
    expect(screen.getByTestId('report-teacher-note')).toHaveTextContent(SECRET)
  })

  /**
   * Это и есть тест печати: печатается ТОЛЬКО портал (`#root` выключен в
   * `@media print`), и заметки в нём нет ни одним узлом — не спрятана, а
   * отсутствует.
   */
  it('в печатном портале заметки НЕТ В РАЗМЕТКЕ', () => {
    render(<StudentReportTab studentId="st-1" />)
    const portal = document.querySelector('.print-portal-wrapper')
    expect(portal).not.toBeNull()
    expect(portal!.innerHTML).not.toContain(SECRET)
    expect(portal!.innerHTML).not.toContain('ВНУТРЕННЯЯ ЗАМЕТКА')
    expect(portal!.querySelector('[data-testid="report-teacher-note"]')).toBeNull()
    // Но сам отчёт там есть — иначе печать была бы пустой.
    expect(portal!.querySelector('[data-testid="parent-report-sheet"]')).not.toBeNull()
  })

  it('своей кнопки печати нет — печатает браузер', () => {
    render(<StudentReportTab studentId="st-1" />)
    expect(screen.queryByRole('button', { name: /печат/i })).toBeNull()
    expect(screen.getByText(/Ctrl \/ Cmd \+ P/)).toBeInTheDocument()
  })

  it('кнопки «собрать черновик ИИ» здесь нет — это соседний блок', () => {
    render(<StudentReportTab studentId="st-1" />)
    expect(screen.queryByRole('button', { name: /черновик/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /ИИ/ })).toBeNull()
  })

  it('период меняется и уезжает в запрос', () => {
    render(<StudentReportTab studentId="st-1" />)
    const from = screen.getByLabelText('Начало периода отчёта') as HTMLInputElement
    fireEvent.change(from, { target: { value: '2026-08-01' } })
    expect(reportMock).toHaveBeenLastCalledWith('st-1', '2026-08-01', expect.any(String))
  })

  it('три строки «что делать» сохраняются с периодом', async () => {
    // §221: период по умолчанию — «с первого числа по сегодня», а ожидание
    // ниже записано датами 25.09. Без закреплённого «сегодня» тест проходил
    // ровно один день — 26.09 полный прогон стал красным. Подменяем только
    // Date: таймеры waitFor остаются настоящими.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T12:00:00'))
    try {
    render(<StudentReportTab studentId="st-1" />)
    const second = screen.getByLabelText('Что делать до следующей встречи, строка 2')
    fireEvent.change(second, { target: { value: 'Отбор корней' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(
      '2026-09-01', '2026-09-25',
      ['Разобрать термодинамику', 'Отбор корней', ''],
      'profile-teacher',
    ))
    } finally {
      vi.useRealTimers()
    }
  })

  it('ошибка расчёта показывается словами, а не пустым экраном', () => {
    reportMock.mockReturnValue({ report: null, loading: false, error: 'Нет доступа к отчёту этого ученика', reload: vi.fn() })
    render(<StudentReportTab studentId="st-1" />)
    expect(screen.getByTestId('report-error')).toHaveTextContent('Нет доступа')
    expect(document.querySelector('.print-portal-wrapper')).toBeNull()
  })
})
