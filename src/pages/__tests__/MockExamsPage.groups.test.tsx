/**
 * §224. «Пробные экзамены»: у каждой группы свой список — чипы групп + «Все».
 * Выбор держится в адресе (?group=…). Плитки сверху не трогаем.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const EXAMS = [
  { id: 'e1', title: 'Пробник 11А №1', date: '2026-09-20', group_id: 'g-a', groups: { name: '11А' }, template_id: 't', max_score: 100, mock_exam_results: [] },
  { id: 'e2', title: 'Пробник 11Б №1', date: '2026-09-21', group_id: 'g-b', groups: { name: '11Б' }, template_id: 't', max_score: 100, mock_exam_results: [] },
  { id: 'e3', title: 'Пробник 11А №2', date: '2026-09-22', group_id: 'g-a', groups: { name: '11А' }, template_id: 't', max_score: 100, mock_exam_results: [] },
]

vi.mock('@/hooks/useMockExams', () => ({ useMockExams: () => ({ exams: EXAMS, myResults: [], loading: false }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p', role: 'teacher' } }),
}))

import { MockExamsPage } from '@/pages/MockExamsPage'

const titles = () => screen.queryAllByRole('heading', { level: 3 }).map(h => h.textContent).filter(t => t?.startsWith('Пробник'))

describe('MockExamsPage — фильтр по группе', () => {
  it('«Все» по умолчанию; чип группы оставляет только её пробники; плитка «Всего» считает все', () => {
    render(<MemoryRouter><MockExamsPage /></MemoryRouter>)
    const chips = screen.getAllByTestId('mock-group-chip')
    expect(chips.map(c => c.textContent)).toEqual(['Все', '11А', '11Б'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(titles()).toEqual(['Пробник 11А №1', 'Пробник 11Б №1', 'Пробник 11А №2'])
    fireEvent.click(chips[2])
    expect(titles()).toEqual(['Пробник 11Б №1'])
    expect(screen.getByText('Всего пробников').parentElement?.parentElement).toHaveTextContent('3')
  })

  it('ссылка с ?group= открывает сразу список группы', () => {
    render(<MemoryRouter initialEntries={['/mock-exams?group=g-a']}><MockExamsPage /></MemoryRouter>)
    expect(titles()).toEqual(['Пробник 11А №1', 'Пробник 11А №2'])
    expect(screen.getByRole('button', { name: '11А' })).toHaveAttribute('aria-pressed', 'true')
  })
})
