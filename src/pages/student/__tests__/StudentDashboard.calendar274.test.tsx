import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §274. «Календарь» на главной: сроки ДЗ из журнала ученика, пробники из
 * `useMyMockExams`, открытия уроков из `useStudentCalendarTopics` — каждое на
 * своём дне по Москве, со ссылкой через группу курса.
 */

vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Иванова Анна', role: 'student' } }),
}))
vi.mock('@/hooks/useStudentDashboard', () => ({
  useStudentDashboard: () => ({
    courses: [{ courseId: 'c1', groupId: 'g1', courseTitle: 'Физика ЕГЭ', subject: 'physics', examType: 'oge' }],
    studentId: 'st-1',
    loading: false,
  }),
}))
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: () => ({ todo: { overdue: [], returned: [], dueSoon: [], noDue: [], tests: [], newlyOpened: [], checked: [], newGrades: [], isClear: true }, loading: false, error: null }),
}))
vi.mock('@/hooks/useStudentHomeActivity', () => ({
  useStudentHomeActivity: () => ({ activity: null, loading: false, error: null, retry: () => {} }),
}))
const JOURNAL = {
  homework: [{
    homework_id: 'hw1', title: 'ДЗ', topic_id: 't1', topic_title: 'Законы Ньютона', module_title: null,
    course_id: 'c1', course_title: 'Физика ЕГЭ', due_at: '2026-10-10', grade_scale: null, status: 'not_started',
    score: null, comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false,
  }],
  tests: [],
  summary: {},
}
vi.mock('@/hooks/useStudentTopicJournal', () => ({
  useStudentTopicJournal: () => ({ journal: JOURNAL, loading: false, error: null, reload: () => {} }),
}))
const MOCKS = {
  g1: [{
    id: 'm1', title: 'Пробник №2', starts_at: '2026-10-09T22:30:00Z', ends_at: '2026-10-10T02:30:00Z',
    photos_until: '2026-10-10T02:45:00Z', submitted_at: null, has_work: false, notified: false, server_now: '2026-10-08T09:00:00Z',
  }],
}
vi.mock('@/hooks/useMyMockExams', () => ({ useMyMockExams: () => MOCKS }))
const TOPICS = [{ id: 't2', title: 'Импульс', available_from: '2026-10-12', is_open: null, kind: 'lesson', course_id: 'c1' }]
const calendarTopics = vi.fn((_ids: string[]) => TOPICS)
vi.mock('@/hooks/useStudentCalendarTopics', () => ({ useStudentCalendarTopics: (ids: string[]) => calendarTopics(ids) }))

import { StudentDashboard } from '@/pages/student/StudentDashboard'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-08T09:00:00Z') })
})
afterEach(() => { vi.useRealTimers() })

describe('StudentDashboard — календарь (§274)', () => {
  it('ДЗ, пробник (по МСК — 10 окт) и открытие урока — на своих днях, со ссылками', async () => {
    render(<MemoryRouter><StudentDashboard /></MemoryRouter>)
    const cal = await screen.findByTestId('student-calendar')
    expect(calendarTopics).toHaveBeenCalledWith(['c1'])
    expect(within(cal).getByTestId('calendar-month')).toHaveTextContent('Октябрь 2026')

    const day10 = within(cal).getAllByTestId('calendar-day').find(c => c.getAttribute('data-day') === '2026-10-10')!
    fireEvent.click(day10)
    const list = within(cal).getByTestId('calendar-day-list')
    const rows = within(list).getAllByTestId('calendar-event')
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['mock', 'homework'])
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/mock/m1')
    expect(rows[0]).toHaveTextContent('01:30')
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/topic/t1')

    const upcoming = within(cal).getByTestId('calendar-upcoming')
    expect(upcoming).toHaveTextContent('Импульс')
    expect(upcoming).toHaveTextContent('пн, 12 окт')
  })
})
