/**
 * §228. «Пробники» ученика — все пробники по всем группам: «Сейчас» (таймер,
 * «Продолжить»), «Скоро», «Прошедшие» (итог и разница с прошлым, иначе «ждёт
 * проверки»); у каждой строки — курс и группа. Время — по часам базы.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    ],
    g2: [row('ph', 'Пробник №2', -27 * 24 * 60, { submitted_at: iso(-27 * 24 * 60 + 200), has_work: true })],
  }),
}))

import { MyMockExamsPage } from '@/pages/student/MyMockExamsPage'

describe('MyMockExamsPage', () => {
  it('Сейчас → Скоро → Прошедшие; курс и группа у каждого; ссылки — в страницу пробника курса', () => {
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
    expect(past.map(c => c.querySelector('b')?.textContent)).toEqual(['Пробник №3', 'Пробник №2', 'Пробник №1'])
    expect(within(past[0]).getByTestId('my-mock-score')).toHaveTextContent('78')
    expect(within(past[0]).getByTestId('my-mock-delta')).toHaveTextContent('+8')
    expect(within(past[1]).getByTestId('my-mock-pill')).toHaveTextContent('ждёт проверки')
    expect(past[1]).toHaveTextContent('Физика ЕГЭ · 11А')
    // У первого пробника группы разницы нет.
    expect(within(past[2]).queryByTestId('my-mock-delta')).toBeNull()
    vi.restoreAllMocks()
  })
})
