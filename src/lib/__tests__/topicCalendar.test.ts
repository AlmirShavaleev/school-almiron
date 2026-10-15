import { describe, expect, it } from 'vitest'
import {
  activityGrid, dateWeeks, mondayOf, planWeeks, progressView, TRIAL_LOCK_NOTE, weekRange, type CalTopicRow,
} from '@/lib/topicCalendar'
import type { CourseTopicLocks } from '@/lib/progressUnlock'

/** Этап 2 ЛК (письмо 15.10): календарь тем и посещения по дням — чистые правила. */
const topic = (id: string, order: number, extra: Partial<CalTopicRow> = {}): CalTopicRow =>
  ({ id, title: `Тема ${id}`, is_open: null, available_from: null, order, ...extra })

describe('даты', () => {
  it('понедельник недели и подпись диапазона', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12')
    expect(mondayOf('2026-10-12')).toBe('2026-10-12')
    expect(mondayOf('2026-10-18')).toBe('2026-10-12')
    expect(weekRange('2026-10-12')).toBe('12–18 окт')
    expect(weekRange('2026-10-26')).toBe('26 окт – 1 ноя')
  })
})

describe('курс по расписанию: недели плана', () => {
  // План стартовал 07.09 → 15.10 идёт 6-я неделя.
  const items = Array.from({ length: 12 }, (_, i) => ({ topic_id: `t${i + 1}`, week_no: i + 1 }))
  const topics = items.map((it, i) => topic(it.topic_id, i, { is_open: i < 6 }))

  it('окно: 2 недели назад, текущая, 4 вперёд; текущая отмечена', () => {
    const weeks = planWeeks('2026-09-07', items, [], topics, '2026-10-15')
    expect(weeks.map(w => w.no)).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(weeks.find(w => w.current)?.no).toBe(6)
    expect(weeks.find(w => w.no === 5)?.past).toBe(true)
  })

  it('закрытая тема будущей недели — с датой открытия (начало её недели)', () => {
    const w7 = planWeeks('2026-09-07', items, [], topics, '2026-10-15').find(w => w.no === 7)!
    expect(w7.topics[0]).toMatchObject({ id: 't7', open: false, opensOn: '2026-10-19' })
  })

  it('личные сдвиги: перенос на другую неделю и снятие темы', () => {
    const weeks = planWeeks('2026-09-07', items, [
      { topic_id: 't7', week_no: 9, removed: false },
      { topic_id: 't8', week_no: null, removed: true },
    ], topics, '2026-10-15')
    expect(weeks.find(w => w.no === 9)?.topics.map(t => t.id).sort()).toEqual(['t7', 't9'])
    expect(weeks.flatMap(w => w.topics).some(t => t.id === 't8')).toBe(false)
  })

  it('план ещё не начался — первые недели; пустой план — ничего', () => {
    expect(planWeeks('2026-11-02', items, [], topics, '2026-10-15').map(w => w.no)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(planWeeks('2026-09-07', [], [], topics, '2026-10-15')).toEqual([])
  })
})

describe('курс по расписанию без плана: недели по датам открытия', () => {
  it('тема с датой попадает в свою неделю; без дат — блока нет', () => {
    const weeks = dateWeeks([topic('a', 1, { available_from: '2026-10-21' }), topic('b', 2)], '2026-10-15')
    expect(weeks).toHaveLength(7)
    expect(weeks.find(w => w.current)?.start).toBe('2026-10-12')
    expect(weeks.find(w => w.start === '2026-10-19')?.topics[0]).toMatchObject({ id: 'a', open: false, opensOn: '2026-10-21' })
    expect(dateWeeks([topic('b', 2)], '2026-10-15')).toEqual([])
  })
})

describe('курс по прохождению', () => {
  const lock = (id: string, open: boolean, closed = false, after: string | null = null) => ({
    topic_id: id, title: `Урок ${id}`, open, reason: open ? 'first2' as const : null, closed,
    percent: null, after_topic_id: null, after_title: after, opens_on: null,
  })
  const locks: CourseTopicLocks = {
    mode: 'progress',
    topics: [lock('1', true, true), lock('2', true), lock('3', false, false, 'Урок 2'), lock('4', false, false, 'Урок 3'), lock('5', false), lock('6', false)],
  }

  it('сейчас открыто, пройдено, следующие 3 с подписью «после урока …»', () => {
    const v = progressView(locks, false, '2026-10-15')
    expect(v.open.map(t => t.id)).toEqual(['2'])
    expect(v.done).toBe(1)
    expect(v.next.map(t => t.id)).toEqual(['3', '4', '5'])
    expect(v.next[0].note).toBe('Откроется после урока «Урок 2»')
    expect(v.lockedTotal).toBe(4)
  })

  it('пробный период: закрытые — «Откроется с подпиской»', () => {
    expect(progressView(locks, true, '2026-10-15').next.every(t => t.note === TRIAL_LOCK_NOTE)).toBe(true)
  })
})

describe('посещения по дням', () => {
  it('12 недель по 7 дней, последняя — текущая; уровни: заходил / задачи', () => {
    const g = activityGrid({
      today: '2026-10-15', streak: 2, record: 5,
      visits: ['2026-10-14', '2026-10-15'], solved: [{ day: '2026-10-15', n: 12 }, { day: '2026-10-10', n: 3 }],
    }, '2000-01-01')
    expect(g.weeks).toHaveLength(12)
    expect(g.weeks.every(w => w.length === 7)).toBe(true)
    const days = g.weeks.flat()
    const at = (d: string) => days.find(x => x.day === d)!
    expect(at('2026-10-14').level).toBe(1)
    expect(at('2026-10-15').level).toBe(4)
    expect(at('2026-10-10').level).toBe(2)
    expect(at('2026-10-16').future).toBe(true)
    expect(g.activeDays).toBe(3)
    expect([g.streak, g.record]).toEqual([2, 5])
  })

  it('нет ответа — пустая карта на «сегодня» клиента', () => {
    const g = activityGrid(null, '2026-10-15')
    expect(g.weeks.flat().every(d => d.level === 0)).toBe(true)
    expect(g.weeks[11][0].day).toBe('2026-10-12')
  })
})
