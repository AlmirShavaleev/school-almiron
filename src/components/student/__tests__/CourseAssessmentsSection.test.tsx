/**
 * §241/§259. Раздел «Контрольные, самостоятельные и пробники» у ученика —
 * только то, что ещё ждёт (§259): работа до начала или идёт и не сдана,
 * пробник до начала или идёт. Прошедшее (сдано, проверено, пропущено, итог
 * пробника) в раздел не попадает, графика пробников и листа результата в
 * разделе нет; ничего не ждёт — раздела нет. Блоки по типам со сводкой,
 * сворачивание (запоминается), строка — переход на работу, идущая работа —
 * строкой сверху с одной главной кнопкой (без дубля с баннером пробника).
 *
 * Лист результата и график (в разделе больше не показываются) проверяются
 * сами по себе — `AssessmentResults.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AssessmentMock, AssessmentWork, MyAssessments } from '@/lib/courseAssessments'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { CourseAssessmentsSection } from '@/components/student/CourseAssessmentsSection'

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

function renderSection(d: MyAssessments, props: { primaryInBanner?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<CourseAssessmentsSection data={d} groupId="g1" now={NOW} {...props} />} />
        <Route path="/my-course/:groupId/mock/:id" element={<p>страница пробника</p>} />
        <Route path="/my-course/:groupId/topic/:id" element={<p>страница темы</p>} />
      </Routes>
    </MemoryRouter>,
  )
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

describe('CourseAssessmentsSection — только ожидающие (§259)', () => {
  it('в разделе — идущая КР и будущий пробник; сданная, проверенная и итоги пробников — нет', () => {
    renderSection(data())
    const blocks = screen.getAllByTestId('assessments-block')
    expect(blocks.map(b => b.getAttribute('data-block'))).toEqual(['mock', 'control'])
    expect(blocks[0]).toHaveTextContent('Пробники · 1')
    expect(within(blocks[0]).getByTestId('assessments-block-summary')).toHaveTextContent('ближайший 5 окт')
    expect(blocks[1]).toHaveTextContent('Контрольные · 1')
    expect(within(blocks[1]).getByTestId('assessments-block-summary')).toHaveTextContent('идёт 1')
    expect(screen.getAllByTestId('assessments-row').map(r => r.getAttribute('data-phase'))).toEqual(['upcoming', 'live'])
    for (const past of ['Тригонометрия', 'Производные', 'Пробник №3', 'Пробник №4']) expect(screen.queryByText(past)).toBeNull()
  })

  it('графика пробников и листа результата в разделе нет', () => {
    renderSection(data())
    expect(screen.queryByTestId('mock-chart')).toBeNull()
    expect(screen.queryByTestId('mock-chart-single')).toBeNull()
    fireEvent.click(screen.getByText('Пробник №5'))
    expect(screen.queryByTestId('assessment-sheet')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('работа без времени (не назначено) в раздел не попадает', () => {
    const { container } = renderSection(data({ works: [work({ topic_id: 'u', title: 'Без времени' })], mocks: [] }))
    expect(container).toBeEmptyDOMElement()
  })

  it('работа сдана прямо в окне — из раздела ушла', () => {
    const { container } = renderSection(data({
      works: [work({ topic_id: 'k', title: 'Кинематика', opens_at: at(-10), closes_at: at(35), status: 'submitted', submitted_at: at(-1) })],
      mocks: [],
    }))
    expect(container).toBeEmptyDOMElement()
  })

  it('всё прошло (написана, проверена, пропущена, итог пробника) — раздела нет', () => {
    const d = data()
    const { container } = renderSection({
      ...d,
      works: [...d.works.filter(w => w.topic_id !== 'k'), work({ topic_id: 'miss', title: 'Пропущенная', opens_at: at(-3 * DAY), closes_at: at(-3 * DAY + 40) })],
      mocks: d.mocks.filter(m => m.id !== 'm5'),
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('блок сворачивается, и это запоминается', () => {
    const { unmount } = renderSection(data())
    const toggle = within(screen.getAllByTestId('assessments-block')[0]).getByTestId('assessments-block-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getAllByTestId('assessments-block')[0]).queryAllByTestId('assessments-row')).toHaveLength(0)
    unmount()
    renderSection(data())
    expect(within(screen.getAllByTestId('assessments-block')[0]).getByTestId('assessments-block-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('строка ведёт на работу: КР — страница темы, пробник — страница пробника', async () => {
    const d = data({ works: [work({ topic_id: 'b', title: 'Статика', opens_at: at(DAY), closes_at: at(DAY + 45) })] })
    const { unmount } = renderSection(d)
    fireEvent.click(screen.getByText('Статика'))
    expect(await screen.findByText('страница темы')).toBeInTheDocument()
    unmount()
    renderSection(d)
    fireEvent.click(screen.getByText('Пробник №5'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('идущая работа — строкой сверху с одной главной кнопкой «Продолжить»', () => {
    renderSection(data())
    const strips = screen.getAllByTestId('assessments-live')
    expect(strips).toHaveLength(1)
    expect(strips[0]).toHaveTextContent('Идёт: Кинематика')
    expect(strips[0]).toHaveTextContent('закроется в 10:45 · осталось 35 мин')
    expect(screen.getAllByTestId('assessments-live-primary')).toHaveLength(1)
    expect(screen.getByTestId('assessments-live-primary')).toHaveTextContent('Продолжить')
    expect(strips[0]).toHaveAttribute('href', '/my-course/g1/topic/k')
  })

  it('идёт пробник и сверху его баннер — строки пробника нет, у КР кнопка тихая (главная одна — в баннере)', () => {
    const d = data({ mocks: [mock({ id: 'run', title: 'Пробник №6', starts_at: at(-30), has_work: true })] })
    renderSection(d, { primaryInBanner: true })
    const strips = screen.getAllByTestId('assessments-live')
    expect(strips.map(s => s.textContent)).toEqual([expect.stringContaining('Кинематика')])
    expect(screen.queryByTestId('assessments-live-primary')).toBeNull()
    expect(screen.getByTestId('assessments-live-open')).toHaveTextContent('Продолжить')
  })

  it('нет ни работ, ни пробников — раздела нет', () => {
    const { container } = renderSection(data({ works: [], mocks: [] }))
    expect(container).toBeEmptyDOMElement()
  })
})
