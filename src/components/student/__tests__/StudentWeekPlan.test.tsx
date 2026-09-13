import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { StudentWeekCourse } from '@/hooks/useStudentWeekPlan'

const hookMock = vi.fn()
vi.mock('@/hooks/useStudentWeekPlan', () => ({
  useStudentWeekPlan: () => hookMock(),
}))

import { StudentWeekPlan } from '@/components/student/StudentWeekPlan'

const course = (over: Partial<StudentWeekCourse> = {}): StudentWeekCourse => ({
  course_id: 'c1', group_id: 'g1', course_title: 'Физика ЕГЭ 10А', subject: 'physics',
  week_no: 1, weeks_total: 85, week_start: '2026-09-07', week_end: '2026-09-13',
  deadline: '2026-09-13T21:00:00+00:00',
  topics: [
    { topic_id: 't1', title: 'Кинематика. Теория', open_now: true, hw_published: true, hw_status: 'accepted', done: true, marked: true },
    { topic_id: 't2', title: 'Кинематика. Первая часть', open_now: true, hw_published: true, hw_status: 'not_started', done: false, marked: false },
    { topic_id: 't3', title: 'Динамика', open_now: true, hw_published: false, hw_status: 'none', done: false, marked: false },
  ],
  ...over,
})

function renderIt(courseId?: string) {
  return render(<MemoryRouter><StudentWeekPlan courseId={courseId} /></MemoryRouter>)
}

describe('StudentWeekPlan — неделя ученика', () => {
  it('без планов не рисует ничего', () => {
    hookMock.mockReturnValue({ courses: [], loading: false, error: null })
    renderIt()
    expect(screen.queryByTestId('student-week-plan')).toBeNull()
  })

  it('текущая неделя: темы, срок до воскресенья, что сдано', () => {
    hookMock.mockReturnValue({ courses: [course()], loading: false, error: null })
    renderIt()
    expect(screen.getByText(/Неделя 1 · 7–13 сен/)).toBeInTheDocument()
    expect(screen.getByText(/Срок — до воскресенья 13 сен · сделано 1 из 3/)).toBeInTheDocument()
    const items = screen.getAllByTestId('student-week-topic')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('ДЗ принято')
    expect(items[1]).toHaveTextContent('ДЗ не сдано')
    // Тема без опубликованного ДЗ не выглядит как «не сдал»
    expect(items[2]).toHaveTextContent('ДЗ нет — отметь тему пройденной')
    expect(items[2]).not.toHaveTextContent('не сдано')
    // Ссылка ведёт на страницу темы своей группы
    expect(items[0].querySelector('a')).toHaveAttribute('href', '/my-course/g1/topic/t1')
  })

  it('фильтр по курсу показывает только его', () => {
    hookMock.mockReturnValue({ courses: [course(), course({ course_id: 'c2', course_title: 'Математика' })], loading: false, error: null })
    renderIt('c2')
    expect(screen.queryByText('Физика ЕГЭ 10А')).toBeNull()
    expect(screen.getAllByTestId('student-week-topic')).toHaveLength(3)
  })

  it('до старта — дата начала, а не пустой список', () => {
    hookMock.mockReturnValue({ courses: [course({ week_no: 0, week_start: '2026-09-14', topics: [] })], loading: false, error: null })
    renderIt()
    expect(screen.getByText(/План начнётся 14 сен/)).toBeInTheDocument()
  })

  it('закрытая тема — без ссылки и с подписью «откроется позже»', () => {
    hookMock.mockReturnValue({
      courses: [course({ topics: [{ topic_id: 't9', title: 'Статика', open_now: false, hw_published: false, hw_status: 'none', done: false, marked: false }] })],
      loading: false, error: null,
    })
    renderIt()
    const item = screen.getByTestId('student-week-topic')
    expect(item.querySelector('a')).toBeNull()
    expect(item).toHaveTextContent('откроется позже')
  })
})
