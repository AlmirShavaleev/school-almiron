import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentCalendarCard } from '@/components/student/home/StudentCalendarCard'
import type { CalendarEvent } from '@/lib/studentCalendar'

/** §274. «Календарь» на главной: сетка, выбор дня, листание, «Ближайшие 7 дней». */

const TODAY = '2026-10-08'

const ev = (id: string, day: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, kind: 'homework', day, title: `Событие ${id}`, course: 'Физика ЕГЭ', href: `/x/${id}`,
  time: null, note: null, done: false, ...over,
})

const EVENTS: CalendarEvent[] = [
  ev('hw', '2026-10-10', { title: 'Законы Ньютона' }),
  ev('mock', '2026-10-10', { kind: 'mock', title: 'Пробник №2', time: '10:00', href: '/my-course/g1/mock/m2' }),
  ev('lesson', '2026-10-12', { kind: 'lesson', title: 'Импульс' }),
  ev('nov', '2026-11-03', { kind: 'work', title: 'Контрольная: Механика' }),
]

function renderCal(events = EVENTS) {
  return render(<MemoryRouter><StudentCalendarCard events={events} today={TODAY} /></MemoryRouter>)
}

const day = (d: string) => screen.getAllByTestId('calendar-day').find(c => c.getAttribute('data-day') === d)!

describe('StudentCalendarCard', () => {
  it('текущий месяц по-русски, неделя с понедельника, первая клетка — пн 28 сент', () => {
    renderCal()
    expect(screen.getByTestId('calendar-month')).toHaveTextContent('Октябрь 2026')
    expect(screen.getAllByTestId('calendar-weekday').map(w => w.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
    const cells = screen.getAllByTestId('calendar-day')
    expect(cells).toHaveLength(35)
    expect(cells[0]).toHaveAttribute('data-day', '2026-09-28')
    expect(cells[3]).toHaveAttribute('data-day', '2026-10-01')
  })

  it('сегодня выбрано по умолчанию; день с событиями подписан для чтения с экрана', () => {
    renderCal()
    expect(day(TODAY)).toHaveAttribute('aria-pressed', 'true')
    expect(day(TODAY)).toHaveAccessibleName('8 октября, сегодня')
    expect(day('2026-10-10')).toHaveAccessibleName('10 октября: 2 события')
    expect(screen.getByTestId('calendar-day-list')).toHaveTextContent('В этот день ничего нет')
  })

  it('клик по дню — список дня в порядке событий, ссылки на свои страницы', () => {
    renderCal()
    fireEvent.click(day('2026-10-10'))
    const list = screen.getByTestId('calendar-day-list')
    expect(list).toHaveTextContent('10 октября')
    const rows = within(list).getAllByTestId('calendar-event')
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['homework', 'mock'])
    expect(within(rows[1]).getByRole('link')).toHaveAttribute('href', '/my-course/g1/mock/m2')
    expect(rows[1]).toHaveTextContent('Пробник · 10:00 · Физика ЕГЭ')
  })

  it('листание: вперёд — ноябрь с контрольной, кнопка «Сегодня» возвращает', () => {
    renderCal()
    fireEvent.click(screen.getByTestId('calendar-next'))
    expect(screen.getByTestId('calendar-month')).toHaveTextContent('Ноябрь 2026')
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(42)
    expect(day('2026-11-01')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(day('2026-11-03'))
    expect(screen.getByTestId('calendar-day-list')).toHaveTextContent('Контрольная: Механика')

    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(screen.getByTestId('calendar-month')).toHaveTextContent('Октябрь 2026')
    expect(day(TODAY)).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('calendar-prev'))
    expect(screen.getByTestId('calendar-month')).toHaveTextContent('Сентябрь 2026')
  })

  it('«Ближайшие 7 дней»: только неделя от сегодня, с подписью дня', () => {
    renderCal()
    const up = screen.getByTestId('calendar-upcoming')
    const rows = within(up).getAllByTestId('calendar-event')
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['homework', 'mock', 'lesson'])
    expect(rows[0]).toHaveTextContent('сб, 10 окт')
    expect(up).not.toHaveTextContent('Контрольная: Механика')
  })

  it('событий нет — сетка есть, неделя свободна', () => {
    renderCal([])
    expect(screen.getByTestId('calendar-upcoming')).toHaveTextContent('Неделя свободна')
    expect(screen.getByTestId('calendar-legend')).toHaveTextContent('Пробник')
  })
})
