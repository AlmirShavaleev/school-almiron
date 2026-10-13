/**
 * §289. Экраны стартовой диагностики: вступление и «Пройти позже», задача и
 * ответ / «Не знаю» (правильность не показывается), продолжение, «задача
 * сменилась», переход к результату; результат (прогноз, карта, слабые места,
 * план, «твой / верный ответ»); блок персонала с «Пройти заново»; чистые
 * функции и карточка на главной. База подменена на уровне `@/lib/diagnostic`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { DiagnosticResult, DiagnosticState } from '@/lib/diagnostic'

const api = vi.hoisted(() => ({
  startDiagnostic: vi.fn(),
  answerDiagnostic: vi.fn(),
  fetchDiagnosticResult: vi.fn(),
  fetchDiagnosticResultFor: vi.fn(),
  resetDiagnostic: vi.fn(),
  skipDiagnostic: vi.fn(),
}))
vi.mock('@/lib/diagnostic', async (orig) => ({ ...(await orig<object>()), ...api }))
vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: true, loading: false }) }))
vi.mock('@/hooks/useStudentPath', () => ({
  useStudentPathHome: () => ({ data: { onboarding: { subject: 'physics' }, subscriptions: [] }, loading: false, refresh: vi.fn() }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'p1', role: 'student' } }),
}))
const forecast = vi.hoisted(() => ({ ready: true }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => Promise.resolve({ data: {}, error: null }) } }))
vi.mock('@/lib/egeForecast', async (orig) => ({
  ...(await orig<object>()),
  normalizeForecastResponse: () => ({ evidence: [], now: new Date() }),
  buildForecastView: () => ({ current: { ready: forecast.ready }, low: 58, high: 67 }),
}))

import { DiagnosticPage } from '../DiagnosticPage'
import { DiagnosticResultPage } from '../DiagnosticResultPage'
import { DiagnosticStaffBlock } from '@/components/student/DiagnosticStaffBlock'
import { DiagnosticError, showDiagnosticCard, studyPlan, weakText } from '@/lib/diagnostic'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}{l.search}</p>
}
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/diagnostic" element={<DiagnosticPage />} />
        <Route path="/diagnostic/result" element={<DiagnosticResultPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const task = (id: string, n: number) => ({
  id, n, title: `Номер ${n}`, statement_html: `<p>Условие ${id}</p>`, content_format: null, assets: [], shown_at: new Date().toISOString(),
})
const st = (over: Partial<DiagnosticState> = {}): DiagnosticState => ({
  session_id: 's1', subject: 'physics', status: 'in_progress', answered: 0, max: 20, task: task('t1', 1), ...over,
})
const RESULT: DiagnosticResult = {
  subject: 'physics', status: 'done', started_at: '2026-10-14T08:00:00Z', finished_at: '2026-10-14T08:20:00Z',
  correct: 11, answered: 18,
  numbers: [{ n: 1, title: 'Кинематика', status: 'green' }, { n: 2, title: 'Динамика', status: 'red' }, { n: 3, title: 'Импульс', status: 'yellow' }, { n: 4, title: 'Статика', status: 'grey' }],
  weak: [{ n: 2, title: 'Динамика' }, { n: 3, title: 'Импульс' }],
  answers: [
    { n: 1, level: 'средняя', title: 'Кинематика', answer: '12', verdict: 'correct', statement_html: '<p>Задача 1</p>', correct_html: '12', assets: [] },
    { n: 2, level: 'сложная', title: 'Динамика', answer: null, verdict: 'dont_know', statement_html: '<p>Задача 2</p>', correct_html: '3,5', assets: [] },
  ],
  onboarding: { grade: 11, target_score: 80, months_to_exam: 8, hours_per_week: 6 },
}

beforeEach(() => {
  vi.clearAllMocks()
  forecast.ready = true
})

describe('/diagnostic', () => {
  it('не начата — вступление; «Пройти позже» — отметка и «Курсы»', async () => {
    api.fetchDiagnosticResult.mockResolvedValue(null)
    api.skipDiagnostic.mockResolvedValue({})
    renderAt('/diagnostic')
    expect(await screen.findByTestId('diagnostic-intro')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('diagnostic-later'))
    expect(await screen.findByTestId('where')).toHaveTextContent('/courses?from=start&subject=physics')
    expect(api.skipDiagnostic).toHaveBeenCalled()
  })

  it('«Начать» → задача; ответ и «Не знаю» уходят в базу, правильность не показывается; конец → результат', async () => {
    api.fetchDiagnosticResult.mockResolvedValueOnce(null).mockResolvedValue(RESULT)
    api.startDiagnostic.mockResolvedValue(st())
    api.answerDiagnostic
      .mockResolvedValueOnce(st({ answered: 1, task: task('t2', 2) }))
      .mockResolvedValueOnce(st({ answered: 2, status: 'done', task: null }))
    renderAt('/diagnostic')
    fireEvent.click(await screen.findByTestId('diagnostic-begin'))
    expect(await screen.findByText('Условие t1')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-step')).toHaveTextContent('Задача 1 из ~20')
    expect(screen.getByTestId('diagnostic-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('diagnostic-answer'), { target: { value: ' 12 ' } })
    fireEvent.click(screen.getByTestId('diagnostic-submit'))
    expect(await screen.findByText('Условие t2')).toBeInTheDocument()
    expect(api.answerDiagnostic).toHaveBeenNthCalledWith(1, expect.objectContaining({ task: expect.objectContaining({ id: 't1' }) }), '12')
    expect(screen.queryByText(/верно|неверно/i)).toBeNull()
    expect((screen.getByTestId('diagnostic-answer') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByTestId('diagnostic-dont-know'))
    await waitFor(() => expect(api.answerDiagnostic).toHaveBeenNthCalledWith(2, expect.anything(), null))
    expect(await screen.findByTestId('diagnostic-result')).toBeInTheDocument()
  })

  it('начата — сразу та же задача (продолжение); «задача сменилась» — актуальная', async () => {
    api.fetchDiagnosticResult.mockResolvedValue({ ...RESULT, status: 'in_progress' })
    api.startDiagnostic.mockResolvedValueOnce(st({ answered: 5, task: task('t6', 7) })).mockResolvedValue(st({ answered: 6, task: task('t7', 8) }))
    api.answerDiagnostic.mockRejectedValue(new DiagnosticError('x', 'STALE'))
    renderAt('/diagnostic')
    expect(await screen.findByText('Условие t6')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-step')).toHaveTextContent('Задача 6 из ~20')
    fireEvent.click(screen.getByTestId('diagnostic-dont-know'))
    expect(await screen.findByText('Условие t7')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-error')).toHaveTextContent('Задача уже сменилась')
  })

  it('пройдена — сразу результат', async () => {
    api.fetchDiagnosticResult.mockResolvedValue(RESULT)
    renderAt('/diagnostic')
    expect(await screen.findByTestId('diagnostic-result')).toBeInTheDocument()
    expect(api.startDiagnostic).not.toHaveBeenCalled()
  })
})

describe('/diagnostic/result', () => {
  it('прогноз и цель, карта, слабые места, план, «Начать 3 дня», «твой / верный ответ»', async () => {
    api.fetchDiagnosticResult.mockResolvedValue(RESULT)
    renderAt('/diagnostic/result')
    await screen.findByTestId('diagnostic-forecast')
    await waitFor(() => expect(screen.getByTestId('diagnostic-forecast')).toHaveTextContent('58–67'))
    expect(screen.getByTestId('diagnostic-forecast')).toHaveTextContent('Ваша цель — 80')
    expect(screen.getAllByTestId('diagnostic-tile').map((t) => t.getAttribute('data-status'))).toEqual(['green', 'red', 'yellow', 'grey'])
    expect(screen.getByTestId('diagnostic-weak')).toHaveTextContent('Динамика (№2)')
    expect(screen.getByTestId('diagnostic-plan')).toHaveTextContent('Начните с темы «Динамика». Темп — 3 темы в неделю.')
    expect(screen.getByTestId('diagnostic-start-course').closest('a')).toHaveAttribute('href', '/courses?from=diagnostic&subject=physics')
    const rows = screen.getAllByTestId('diagnostic-answer-row')
    expect(rows).toHaveLength(2)
    expect(screen.getAllByTestId('diagnostic-my-answer').map((x) => x.textContent)).toEqual(['12', '«Не знаю»'])
    expect(screen.getAllByTestId('diagnostic-correct-answer')[1]).toHaveTextContent('3,5')
  })

  it('прогноз ещё не готов — без цифр; не пройдена — на тест', async () => {
    forecast.ready = false
    api.fetchDiagnosticResult.mockResolvedValue(RESULT)
    const first = renderAt('/diagnostic/result')
    expect(await screen.findByText(/Прогноз считается/)).toBeInTheDocument()
    first.unmount()
    api.fetchDiagnosticResult.mockResolvedValue(null)
    renderAt('/diagnostic/result')
    expect(await screen.findByTestId('diagnostic-intro')).toBeInTheDocument()
  })
})

describe('персоналу и главная', () => {
  it('блок в карточке ученика; «Пройти заново» — с подтверждением; нет диагностики — блока нет', async () => {
    api.fetchDiagnosticResultFor.mockResolvedValueOnce(RESULT).mockResolvedValue(null)
    api.resetDiagnostic.mockResolvedValue(true)
    const { container } = render(<DiagnosticStaffBlock studentId="st1" />)
    expect(await screen.findByTestId('diagnostic-staff')).toHaveTextContent('верно 11 из 18')
    expect(screen.getByTestId('diagnostic-staff')).toHaveTextContent('Слабые места: Динамика (№2), Импульс (№3)')
    fireEvent.click(screen.getByTestId('diagnostic-staff-reset'))
    fireEvent.click(await screen.findByTestId('diagnostic-reset-confirm-confirm'))
    await waitFor(() => expect(api.resetDiagnostic).toHaveBeenCalledWith('st1'))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('карточка на главной — анкета пройдена, диагностика не начата или отложена', () => {
    const o = (completed: boolean, status: 'none' | 'skipped' | 'in_progress' | 'done') => ({
      needed: false, completed, grade: 11, exam: 'ege' as const, subject: 'physics' as const, target_score: 80,
      months_to_exam: null, hours_per_week: null, diagnostic_status: status,
    })
    expect(showDiagnosticCard(o(true, 'none'))).toBe(true)
    expect(showDiagnosticCard(o(true, 'skipped'))).toBe(true)
    expect(showDiagnosticCard(o(true, 'done'))).toBe(false)
    expect(showDiagnosticCard(o(true, 'in_progress'))).toBe(false)
    expect(showDiagnosticCard(o(false, 'none'))).toBe(false)   // школьник: анкеты нет
    expect(showDiagnosticCard(null)).toBe(false)
  })

  it('план и слабые места словами', () => {
    expect(studyPlan(null, []).text).toBe('Начните с первого раздела курса. Темп — 2 темы в неделю.')
    expect(studyPlan(1, []).topicsPerWeek).toBe(1)
    expect(studyPlan(30, []).topicsPerWeek).toBe(5)
    expect(weakText({ n: 7, title: null })).toBe('Задание №7')
  })
})
