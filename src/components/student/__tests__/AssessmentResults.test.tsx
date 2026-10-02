/**
 * §241. Лист результата строки (пробник: вторичный/первичный, части, баллы по
 * номерам, группа, «+N»; проверочная: оценка, отметки, группа) и график
 * пробников. С §259 в разделе курса ученика их нет (там только ожидающие), сами
 * компоненты оставлены — владелец ещё решит, где ученику смотреть результаты.
 * Тесты перенесены сюда из `CourseAssessmentsSection.test.tsx` без изменений
 * проверок: рендерим компоненты напрямую.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  assessmentItems, mockChartPoints, type AssessmentItem, type AssessmentMock, type AssessmentWork, type MyAssessments,
} from '@/lib/courseAssessments'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { AssessmentDetailSheet } from '@/components/student/AssessmentDetailSheet'
import { MockScoreChart } from '@/components/student/MockScoreChart'

const NOW = Date.parse('2026-10-02T07:10:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const DAY = 24 * 60

const work = (p: Partial<AssessmentWork> & { topic_id: string; title: string }): AssessmentWork => ({
  homework_id: `hw-${p.topic_id}`, kind: 'control', module_id: 'm1', module_title: 'Работы', topic_open: true,
  available_from: null, grade_scale: 'five', opens_at: null, closes_at: null, personal: false, status: 'none',
  submitted_at: null, reviewed_at: null, score: null, tasks: null, group: null, ...p,
})
const mock = (p: Partial<AssessmentMock> & { id: string; title: string; starts_at: string }): AssessmentMock => ({
  ends_at: new Date(Date.parse(p.starts_at) + 235 * 60_000).toISOString(),
  photos_until: new Date(Date.parse(p.starts_at) + 250 * 60_000).toISOString(),
  duration_minutes: 235, submitted_at: null, has_work: false, notified: false, score: null, max_score: null, server_now: at(0), ...p,
})

function data(over: Partial<MyAssessments> = {}): MyAssessments {
  return {
    serverNow: at(0),
    works: [
      work({ topic_id: 'k', title: 'Кинематика', opens_at: at(-10), closes_at: at(35), status: 'draft' }),
      work({ topic_id: 'trig', title: 'Тригонометрия', opens_at: at(-13 * DAY), closes_at: at(-13 * DAY + 45), status: 'submitted', submitted_at: at(-13 * DAY + 30) }),
      work({
        topic_id: 'der', title: 'Производные', kind: 'check', opens_at: at(-10 * DAY), closes_at: at(-10 * DAY + 40), status: 'reviewed', score: 5,
        tasks: [{ no: '1', verdict: 'correct' }, { no: '2', verdict: 'partial' }, { no: '3', verdict: 'wrong' }],
        group: { avg: 4.1, count: 16, submitted: 16, in_group: 18, better_pct: 70, best: false },
      }),
    ],
    mocks: [
      mock({ id: 'm3', title: 'Пробник №3', starts_at: at(-13 * DAY), notified: true, has_work: true, score: 58, max_score: 100, primary_score: 14, primary_max: 32, group: { avg: 60, count: 15, better_pct: null, best: false } }),
      mock({ id: 'm4', title: 'Пробник №4', starts_at: at(-6 * DAY), notified: true, has_work: true, score: 72, max_score: 100, primary_score: 18, primary_max: 32, part1_score: 11, part2_score: 7, prev_score: 58, group: { avg: 63, count: 14, better_pct: 70, best: false } }),
      mock({ id: 'm5', title: 'Пробник №5', starts_at: at(3 * DAY) }),
    ],
    ...over,
  }
}

function itemOf(d: MyAssessments, key: string): AssessmentItem {
  const i = assessmentItems(d, NOW).find(x => x.key === key)
  if (!i) throw new Error(`нет строки ${key}`)
  return i
}

function renderSheet(item: AssessmentItem, onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<AssessmentDetailSheet item={item} groupId="g1" onClose={onClose} />} />
        <Route path="/my-course/:groupId/mock/:id" element={<p>страница пробника</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return onClose
}

beforeEach(() => {
  localStorage.clear()
  rpc.mockReset()
  rpc.mockResolvedValue({
    data: {
      status: 'ready', title: 'Пробник №4', notified_at: at(-DAY), score: 72, max_score: 100, primary_score: 18,
      part1_score: 11, part2_score: 7, part1_last: 2, solution_path: null,
      tasks: [{ n: 1, max: 1, points: 1, answer: '1', correct: '1' }, { n: 2, max: 1, points: 0, answer: '2', correct: '3' }, { n: 3, max: 3, points: 1, answer: null, correct: null }],
    },
    error: null,
  })
})

describe('AssessmentDetailSheet', () => {
  it('пробник с итогом: вторичный/первичный, части, баллы по номерам, группа и «+N»; ссылка на работу', async () => {
    renderSheet(itemOf(data(), 'mock:m4'))
    const sheet = await screen.findByTestId('assessment-sheet')
    expect(within(sheet).getByTestId('sheet-secondary')).toHaveTextContent('72из 100')
    expect(within(sheet).getByTestId('sheet-primary')).toHaveTextContent('18из 32')
    expect(within(sheet).getByTestId('sheet-group')).toHaveTextContent('средний 63 · написали 14 · ты лучше, чем 70 % группы')
    expect(within(sheet).getByTestId('sheet-group')).toHaveTextContent('Прошлый пробник — 58, сейчас +14')
    expect(rpc).toHaveBeenCalledWith('my_mock_exam_result', { p_mock_exam_id: 'm4' })
    const cells = await within(sheet).findAllByTestId('sheet-mock-task')
    expect(cells.map(c => c.textContent)).toEqual(['11', '20', '31/3'])
    expect(within(sheet).getByTestId('sheet-part1')).toHaveTextContent('Часть 111из 2')
    expect(within(sheet).getByTestId('sheet-part2')).toHaveTextContent('Часть 27из 3')
    fireEvent.click(within(sheet).getByTestId('sheet-open-work'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('проверочная: оценка, отметки по заданиям, группа; «Назад» и Esc закрывают', () => {
    const onClose = renderSheet(itemOf(data(), 'work:der'))
    const sheet = screen.getByTestId('assessment-sheet')
    expect(within(sheet).getByTestId('sheet-grade')).toHaveTextContent('Оценка5пятибалльная')
    expect(within(sheet).getByTestId('sheet-marks')).toHaveTextContent('1 из 3')
    expect(within(sheet).getAllByTestId('sheet-work-task').map(t => t.getAttribute('data-verdict'))).toEqual(['correct', 'partial', 'wrong'])
    expect(within(sheet).getByTestId('sheet-group')).toHaveTextContent('средняя оценка 4,1 · сдали 16 из 18 · ты лучше, чем 70 % группы')
    expect(document.activeElement).toBe(within(sheet).getByTestId('assessment-sheet-back'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('assessment-sheet-back'))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('MockScoreChart', () => {
  it('два и больше итогов — линия с подсказкой; меньше двух — одно число', () => {
    const { unmount } = render(<MockScoreChart points={mockChartPoints(data().mocks, NOW)} />)
    expect(screen.getAllByTestId('mock-chart-dot')).toHaveLength(2)
    expect(screen.getByTestId('mock-chart-last')).toHaveTextContent('72')
    expect(screen.getAllByTestId('mock-chart-group-dot')).toHaveLength(2)
    expect(screen.getByTestId('mock-chart-svg').getAttribute('aria-label')).toContain('Пробник №4 (26 сент) — 72')
    fireEvent.click(screen.getAllByTestId('mock-chart-hit')[1])
    expect(screen.getByTestId('mock-chart-tip')).toHaveTextContent('Ты: 72 · группа: 63')
    expect(screen.getByTestId('mock-chart-tip')).toHaveTextContent('+14 к прошлому')
    unmount()
    render(<MockScoreChart points={mockChartPoints([data().mocks[1]], NOW)} />)
    expect(screen.queryByTestId('mock-chart')).toBeNull()
    expect(screen.getByTestId('mock-chart-single')).toHaveTextContent('72вторичный · Пробник №4 · средний по группе 63')
  })

  it('группа на графике — только там, где правило троих выполнено', () => {
    const d = data()
    d.mocks[0] = { ...d.mocks[0], group: null }
    render(<MockScoreChart points={mockChartPoints(d.mocks, NOW)} />)
    expect(screen.getAllByTestId('mock-chart-group-dot')).toHaveLength(1)
  })
})
