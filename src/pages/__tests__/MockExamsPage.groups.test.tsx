/**
 * §224. «Пробные экзамены»: у каждой группы свой список — чипы групп + «Все».
 * Выбор держится в адресе (?group=…). Результаты открываются внутри пробника.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { windowOf } from '@/lib/mockExamV3'

const windowAt = (hours: number) => windowOf({ starts_at: new Date(Date.now() + hours * 3_600_000).toISOString() })

const EXAMS = [
  {
    id: 'e1', title: 'Пробник 11А №1', date: '2026-09-20', group_id: 'g-a', groups: { name: '11А' },
    template_id: 't', starts_at: '2026-09-20T08:00:00Z', max_score: 100,
    mock_exam_results: [{ student_id: 's1', score: 82, students: { profiles: { full_name: 'Тестовый ученик' } } }],
    progress: { window: windowAt(-6), hasWork: true, allChecked: false },
  },
  {
    id: 'e2', title: 'Пробник 11Б №1', date: '2026-09-21', group_id: 'g-b', groups: { name: '11Б' }, max_score: 100,
    progress: { window: windowAt(2), hasWork: false, allChecked: false },
  },
  {
    id: 'e3', title: 'Пробник 11А №2', date: '2026-09-22', group_id: 'g-a', groups: { name: '11А' }, max_score: 100,
    progress: { window: windowAt(-1), hasWork: false, allChecked: false },
  },
  {
    id: 'e4', title: 'Пробник без группы', date: '2026-08-01', group_id: null, groups: null, max_score: 100,
    progress: { window: windowOf({ starts_at: null }), hasWork: true, allChecked: true },
  },
]

const { loadExportExams, exportMockExams } = vi.hoisted(() => ({ loadExportExams: vi.fn(), exportMockExams: vi.fn() }))
vi.mock('@/hooks/useMockExams', () => ({ useMockExams: () => ({ exams: EXAMS, myResults: [], loading: false, loadExportExams }) }))
vi.mock('@/utils/exportExcel', () => ({ exportMockExams }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p', role: 'teacher' } }),
}))

import { MockExamsPage } from '@/pages/MockExamsPage'

const titles = () => screen.queryAllByRole('heading', { level: 3 }).map(h => h.textContent).filter(t => t?.startsWith('Пробник'))

describe('MockExamsPage — фильтр по группе', () => {
  it('«Все» по умолчанию; чип группы оставляет только её пробники; счётчик показывает выбранные из всех', () => {
    render(<MemoryRouter><MockExamsPage /></MemoryRouter>)
    const chips = screen.getAllByTestId('mock-group-chip')
    expect(chips.map(c => c.textContent)).toEqual(['Все', '11А', '11Б'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(titles()).toEqual(['Пробник 11А №1', 'Пробник 11Б №1', 'Пробник 11А №2', 'Пробник без группы'])
    fireEvent.click(chips[2])
    expect(titles()).toEqual(['Пробник 11Б №1'])
    expect(screen.getByText('1 из 4')).toBeInTheDocument()
  })

  it('ссылка с ?group= открывает сразу список группы', () => {
    render(<MemoryRouter initialEntries={['/mock-exams?group=g-a']}><MockExamsPage /></MemoryRouter>)
    expect(titles()).toEqual(['Пробник 11А №1', 'Пробник 11А №2'])
    expect(screen.getByRole('button', { name: '11А' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('у строки одна ссылка на пробник, в том числе без группы, а баллы и имя ученика скрыты', () => {
    render(<MemoryRouter><MockExamsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Пробник 11А №1' })).toHaveAttribute('href', '/mock-exams/e1')
    expect(screen.getByRole('link', { name: 'Пробник без группы' })).toHaveAttribute('href', '/mock-exams/e4')
    expect(screen.queryByRole('link', { name: /Онлайн|Таблица|Настройка/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Средний балл|Тестовый ученик|^82$/)).not.toBeInTheDocument()
  })

  it('статус виден и доступен как описание ссылки на пробник', () => {
    render(<MemoryRouter><MockExamsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Пробник 11А №1' })).toHaveAccessibleDescription('Ждёт проверки')
    expect(screen.getByRole('link', { name: 'Пробник 11Б №1' })).toHaveAccessibleDescription('Ожидается')
    expect(screen.getByRole('link', { name: 'Пробник 11А №2' })).toHaveAccessibleDescription('Идёт')
    expect(screen.getByRole('link', { name: 'Пробник без группы' })).toHaveAccessibleDescription('Проверено')
  })

  it('результаты для Excel загружаются по кнопке и с выбранной группой', async () => {
    loadExportExams.mockResolvedValueOnce({ data: [EXAMS[0]], error: null })
    render(<MemoryRouter initialEntries={['/mock-exams?group=g-a']}><MockExamsPage /></MemoryRouter>)
    expect(loadExportExams).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
    expect(loadExportExams).toHaveBeenCalledWith('g-a')
    await waitFor(() => expect(exportMockExams).toHaveBeenCalledWith([
      expect.objectContaining({ score: 82, studentName: 'Тестовый ученик', groupName: '11А' }),
    ]))
  })
})
