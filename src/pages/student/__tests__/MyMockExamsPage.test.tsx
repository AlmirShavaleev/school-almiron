/**
 * §228. «Пробники» ученика — все пробники по всем группам: «Сейчас» (таймер,
 * «Продолжить»), «Скоро», «Прошедшие» (итог и разница с прошлым, иначе «ждёт
 * проверки»); у каждой строки — курс и группа. Время — по часам базы.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const MIN = 60_000
const now = Date.now()
const iso = (off: number) => new Date(now + off * MIN).toISOString()
const row = (id: string, title: string, startOff: number, over: Record<string, unknown> = {}) => ({
  id, title, starts_at: iso(startOff), ends_at: iso(startOff + 235), photos_until: iso(startOff + 250), duration_minutes: 235,
  submitted_at: null, has_work: false, notified: false, score: null, max_score: null, server_now: iso(0), ...over,
})
// Часы телефона ушли на сутки вперёд — «сейчас» всё равно считается от server_now.
const SERVER_SKEW = 24 * 60 * MIN
const fetchForecast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/scoreForecast', () => ({ fetchMyScoreForecast: fetchForecast }))

vi.mock('@/hooks/useMyCourseMemberships', () => ({
  useMyCourseMemberships: () => ({
    loading: false, error: null, reload: () => {},
    courses: [
      { courseId: 'c1', title: 'Математика ЕГЭ', subject: 'math', examType: 'ege', primaryGroupId: 'g1', groups: [{ groupId: 'g1', groupTitle: '11А', groupType: 'group' }] },
      { courseId: 'c2', title: 'Физика ЕГЭ', subject: 'physics', examType: 'ege', primaryGroupId: 'g2', groups: [{ groupId: 'g2', groupTitle: '11А', groupType: 'group' }] },
    ],
  }),
}))
vi.mock('@/hooks/useMyMockExams', () => ({
  useMyMockExams: () => ({
    g1: [
      row('run', 'Пробник №4', -74, { has_work: true }),
      row('soon', 'Пробник №5', 6 * 24 * 60 + 10),
      row('p3', 'Пробник №3', -13 * 24 * 60, { submitted_at: iso(-13 * 24 * 60 + 200), has_work: true, notified: true, score: 78, max_score: 100 }),
      row('p1', 'Пробник №1', -40 * 24 * 60, { submitted_at: iso(-40 * 24 * 60 + 200), has_work: true, notified: true, score: 70, max_score: 100 }),
      row('raw', 'Пробник по другой шкале', -8 * 24 * 60, { notified: true, score: 20, max_score: 30 }),
    ],
    g2: [
      row('ph', 'Пробник №2', -27 * 24 * 60, { submitted_at: iso(-27 * 24 * 60 + 200), has_work: true, score: 99 }),
      row('ph-posted', 'Пробник по физике', -41 * 24 * 60, { notified: true, score: 0, max_score: 100 }),
    ],
  }),
}))

import { MyMockExamsPage } from '@/pages/student/MyMockExamsPage'

describe('MyMockExamsPage', () => {
  it('Сейчас → Скоро → Прошедшие; курс и группа у каждого; ссылки — в страницу пробника курса', async () => {
    fetchForecast.mockReset().mockResolvedValue([])
    vi.spyOn(Date, 'now').mockReturnValue(now + SERVER_SKEW)
    render(<MemoryRouter><MyMockExamsPage /></MemoryRouter>)
    const nowSec = screen.getByTestId('my-mock-now')
    expect(within(nowSec).getByTestId('my-mock-card')).toHaveTextContent('Математика ЕГЭ · 11А')
    expect(within(nowSec).getByTestId('my-mock-open')).toHaveTextContent('Продолжить')
    expect(within(nowSec).getByTestId('my-mock-open')).toHaveAttribute('href', '/my-course/g1/mock/run')
    // Осталось 235 − 74 = 161 мин по часам базы, а не телефона.
    expect(within(nowSec).getByTestId('my-mock-countdown').textContent).toMatch(/^2:4[01]:\d\d$/)
    expect(screen.getByTestId('my-mock-upcoming')).toHaveTextContent('через 6 дней')
    const past = within(screen.getByTestId('my-mock-past')).getAllByTestId('my-mock-card')
    expect(past.map(c => c.querySelector('b')?.textContent)).toEqual([
      'Пробник по другой шкале', 'Пробник №3', 'Пробник №2', 'Пробник №1', 'Пробник по физике',
    ])
    expect(within(past[0]).queryByTestId('my-mock-delta')).toBeNull()
    expect(within(past[1]).getByTestId('my-mock-score')).toHaveTextContent('78')
    expect(within(past[1]).getByTestId('my-mock-delta')).toHaveTextContent('+8')
    expect(within(past[2]).getByTestId('my-mock-pill')).toHaveTextContent('ждёт проверки')
    expect(within(past[2]).queryByTestId('my-mock-score')).not.toBeInTheDocument()
    expect(past[2]).toHaveTextContent('Физика ЕГЭ · 11А')
    expect(within(past[3]).queryByTestId('my-mock-delta')).toBeNull()
    expect(await screen.findByText('Пока мало данных')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('диаграмма и прогноз меняются с предметом, результаты разных шкал разделены', async () => {
    fetchForecast.mockReset().mockResolvedValue([
      { subject: 'math', score: 84, low: 79, high: 88, ready: true },
      { subject: 'physics', score: 67, low: 64, high: 70, ready: true },
    ])
    render(<MemoryRouter><MyMockExamsPage /></MemoryRouter>)
    const history = within(screen.getByRole('region', { name: 'Динамика результатов' }))
    const subject = history.getByRole('combobox', { name: 'Предмет' })
    const chart = () => history.getByRole('img')
    expect(chart()).toHaveAccessibleName(/Математика.*: 70;.*: 78$/)
    expect(history.getByTestId('mock-history-best')).toHaveTextContent('78 из 100')
    expect(await history.findByText('Диапазон 79–88')).toBeInTheDocument()
    expect(history.getByTestId('mock-history-forecast')).toHaveTextContent('84 из 100')

    const physics = history.getByRole('option', { name: 'Физика' }) as HTMLOptionElement
    fireEvent.change(subject, { target: { value: physics.value } })
    expect(chart()).toHaveAccessibleName(/Физика.*: 0$/)
    expect(history.getByTestId('mock-history-best')).toHaveTextContent('0 из 100')
    expect(history.getByTestId('mock-history-forecast')).toHaveTextContent('67 из 100')

    const raw = history.getByRole('option', { name: /Математика.*из 30/ }) as HTMLOptionElement
    fireEvent.change(subject, { target: { value: raw.value } })
    expect(chart()).toHaveAccessibleName(/Математика.*: 20$/)
    expect(history.getByTestId('mock-history-best')).toHaveTextContent('20 из 30')
    expect(history.getByTestId('mock-history-forecast')).toHaveTextContent('84 из 100')
    expect(fetchForecast).toHaveBeenCalledTimes(1)
  })

  it('в демо два примера без ссылок на пробники и без запроса прогноза', () => {
    fetchForecast.mockClear()
    render(<MemoryRouter initialEntries={['/my-mock-exams?demo=1']}><MyMockExamsPage /></MemoryRouter>)
    const past = within(screen.getByTestId('my-mock-past'))
    expect(past.getAllByRole('article')).toHaveLength(2)
    expect(past.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName(/Математика.*: 68;.*: 82$/)
    expect(screen.getByTestId('mock-history-forecast')).toHaveTextContent('86 из 100')
    expect(fetchForecast).not.toHaveBeenCalled()
  })
})
