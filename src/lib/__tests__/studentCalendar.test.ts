import { describe, expect, it } from 'vitest'
import {
  buildCalendarEvents, eventsByDay, monthGrid, relativeDayLabel, shiftMonth, shortDayLabel, upcomingEvents,
  type CalendarHomework, type CalendarTopic,
} from '@/lib/studentCalendar'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

/** §274. Календарь главной ученика: сетка месяца и раскладка событий по дням МСК. */

const courses = [
  { courseId: 'c1', groupId: 'g1', title: 'Физика ЕГЭ' },
  { courseId: 'c2', groupId: 'g2', title: 'Математика ЕГЭ' },
]

const hw = (id: string, over: Partial<CalendarHomework> = {}): CalendarHomework => ({
  homework_id: id, title: 'ДЗ', topic_id: `t-${id}`, topic_title: `Тема ${id}`, course_id: 'c1',
  due_at: '2026-10-10', status: 'not_started', ...over,
})

const topic = (id: string, over: Partial<CalendarTopic> = {}): CalendarTopic => ({
  id, title: `Урок ${id}`, available_from: '2026-10-12', is_open: null, kind: 'lesson', course_id: 'c2', ...over,
})

const mock = (id: string, startsAt: string, over: Partial<MockLessonListRow> = {}): MockLessonListRow => ({
  id, title: `Пробник ${id}`, starts_at: startsAt, ends_at: startsAt, photos_until: startsAt,
  submitted_at: null, has_work: false, notified: false, server_now: startsAt, ...over,
})

describe('monthGrid — неделя с понедельника', () => {
  it('октябрь 2026: 1-е — четверг, сетка с пн 28 сент по вс 1 нояб', () => {
    const weeks = monthGrid(2026, 9)
    expect(weeks).toHaveLength(5)
    expect(weeks.every(w => w.length === 7)).toBe(true)
    expect(weeks[0].map(c => c.date)).toEqual([28, 29, 30, 1, 2, 3, 4])
    expect(weeks[0][0]).toMatchObject({ day: '2026-09-28', inMonth: false })
    expect(weeks[0][3]).toMatchObject({ day: '2026-10-01', inMonth: true })
    expect(weeks[4][6]).toMatchObject({ day: '2026-11-01', inMonth: false })
  })

  it('ноябрь 2026 начинается в воскресенье — шесть недель, 1-е в последней колонке', () => {
    const weeks = monthGrid(2026, 10)
    expect(weeks).toHaveLength(6)
    expect(weeks[0][6]).toMatchObject({ day: '2026-11-01', inMonth: true })
    expect(weeks[0].slice(0, 6).every(c => !c.inMonth)).toBe(true)
  })

  it('февраль 2027 с понедельника — ровно четыре недели без хвостов', () => {
    const weeks = monthGrid(2027, 1)
    expect(weeks).toHaveLength(4)
    expect(weeks.flat().every(c => c.inMonth)).toBe(true)
  })

  it('листание через границу года', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('buildCalendarEvents', () => {
  it('ДЗ — в день срока, ссылка на тему через группу курса; статусы словами', () => {
    const events = buildCalendarEvents({
      courses, topics: [], mocksByGroup: {}, today: '2026-10-08',
      homework: [
        hw('h1'),
        hw('h2', { due_at: '2026-10-05' }),
        hw('h3', { due_at: '2026-10-05', status: 'submitted' }),
        hw('h4', { due_at: null }),
      ],
    })
    expect(events.map(e => [e.id, e.day, e.note, e.done])).toEqual([
      ['homework:h2', '2026-10-05', 'просрочено', false],
      ['homework:h3', '2026-10-05', 'сдано', true],
      ['homework:h1', '2026-10-10', null, false],
    ])
    expect(events[2]).toMatchObject({ course: 'Физика ЕГЭ', href: '/my-course/g1/topic/t-h1', title: 'Тема h1' })
  })

  it('пробник — в день начала ПО МОСКВЕ: 22:30 UTC 9 окт — это 10 окт, 01:30', () => {
    const events = buildCalendarEvents({
      courses, homework: [], topics: [], today: '2026-10-08',
      mocksByGroup: { g2: [mock('m1', '2026-10-09T22:30:00Z')] },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'mock', day: '2026-10-10', time: '01:30', course: 'Математика ЕГЭ', href: '/my-course/g2/mock/m1',
    })
  })

  it('открытие урока — только у темы на автоматике; закрытая ведёт в курс, открытая — на тему', () => {
    const events = buildCalendarEvents({
      courses, homework: [], mocksByGroup: {}, today: '2026-10-08',
      topics: [
        topic('t1'),
        topic('t2', { is_open: false }),
        topic('t3', { is_open: true }),
        topic('t4', { available_from: '2026-10-01' }),
        topic('t5', { kind: 'control', available_from: '2026-10-20' }),
      ],
    })
    expect(events.map(e => e.id)).toEqual(['lesson:t4', 'lesson:t1', 'work:t5'])
    expect(events[0]).toMatchObject({ href: '/my-course/g2/topic/t4', note: 'открыт' })
    expect(events[1]).toMatchObject({ href: '/my-course/g2', note: null })
    expect(events[2]).toMatchObject({ kind: 'work', note: 'контрольная' })
  })

  it('в одном дне — пробник раньше ДЗ, ДЗ раньше урока', () => {
    const events = buildCalendarEvents({
      courses, today: '2026-10-08',
      homework: [hw('h1', { due_at: '2026-10-12' })],
      topics: [topic('t1')],
      mocksByGroup: { g1: [mock('m1', '2026-10-12T07:00:00Z')] },
    })
    expect(eventsByDay(events).get('2026-10-12')?.map(e => e.kind)).toEqual(['mock', 'homework', 'lesson'])
  })
})

describe('Ближайшие 7 дней и подписи', () => {
  it('сегодня + шесть дней, закрытые дела не входят', () => {
    const events = buildCalendarEvents({
      courses, topics: [], mocksByGroup: {}, today: '2026-10-08',
      homework: [
        hw('past', { due_at: '2026-10-07' }),
        hw('today', { due_at: '2026-10-08' }),
        hw('last', { due_at: '2026-10-14' }),
        hw('later', { due_at: '2026-10-15' }),
        hw('done', { due_at: '2026-10-09', status: 'accepted' }),
      ],
    })
    expect(upcomingEvents(events, '2026-10-08').map(e => e.id)).toEqual(['homework:today', 'homework:last'])
  })

  it('«сегодня», «завтра», «пт, 10 окт»', () => {
    expect(relativeDayLabel('2026-10-08', '2026-10-08')).toBe('сегодня')
    expect(relativeDayLabel('2026-10-09', '2026-10-08')).toBe('завтра')
    expect(relativeDayLabel('2026-10-10', '2026-10-08')).toBe('сб, 10 окт')
    expect(shortDayLabel('2026-10-09')).toBe('пт, 9 окт')
  })
})
