import { describe, expect, it } from 'vitest'
import {
  formatAgo, formatHour, parseFeed, parsePulse, peakHour, reachShare,
  totalHourEvents, weekChange, weekDirection,
} from '@/lib/livePulse'

/**
 * Пересчёт чисел живой панели.
 *
 * Сторожатся места, где экран легко соврал бы молча: рост с нуля, час пик на
 * пустых данных, чужой формат из Postgres и относительное время.
 */

describe('неделя к неделе', () => {
  it('считает долю изменения', () => {
    // Живые числа на 10.09: 110 заходов против 23 неделей раньше.
    expect(Math.round((weekChange(110, 23) ?? 0) * 100)).toBe(378)
    expect(Math.round((weekChange(5, 10) ?? 0) * 100)).toBe(-50)
  })

  it('рост с нуля процентом НЕ выражается', () => {
    // На проде это ровно случай сдач: 23 на этой неделе против 0 на прошлой.
    // +2300 % — не число, а шум; экран в этом случае пишет словами.
    expect(weekChange(23, 0)).toBeNull()
    expect(weekChange(0, 0)).toBeNull()
  })

  it('направление различает рост, спад и ровное значение', () => {
    expect(weekDirection(10, 5)).toBe('up')
    expect(weekDirection(5, 10)).toBe('down')
    // Ровно — это не «рост на ноль процентов», а отдельное состояние.
    expect(weekDirection(7, 7)).toBe('flat')
  })
})

describe('час пик', () => {
  const hours = (list: number[]) => list.map((events, hour) => ({ hour, events }))

  it('находит самый нагруженный час', () => {
    const peak = peakHour(hours([0, 0, 0, 5, 12, 3]))
    expect(peak?.hour).toBe(4)
    expect(peak?.events).toBe(12)
  })

  it('на пустых данных возвращает null, а не полночь', () => {
    // Иначе экран уверенно сообщил бы, что школа учится в 00:00.
    expect(peakHour(hours([0, 0, 0, 0]))).toBeNull()
    expect(peakHour([])).toBeNull()
  })

  it('считает общее число событий — подпись «на чём построено»', () => {
    expect(totalHourEvents(hours([1, 2, 3]))).toBe(6)
    expect(totalHourEvents([])).toBe(0)
  })

  it('час подписывается двумя цифрами', () => {
    expect(formatHour(9)).toBe('09:00')
    expect(formatHour(14)).toBe('14:00')
  })
})

describe('охват', () => {
  it('доля активных от зачисленных', () => {
    // Живые числа: 29 из 32.
    expect(Math.round((reachShare(29, 32) ?? 0) * 100)).toBe(91)
  })

  it('без зачисленных доля не определена, а не равна нулю', () => {
    // Ноль читался бы как «никто не заходит», хотя заходить просто некому.
    expect(reachShare(0, 0)).toBeNull()
  })

  it('не превышает единицу при странных данных', () => {
    expect(reachShare(40, 32)).toBe(1)
  })
})

describe('относительное время', () => {
  const now = new Date('2026-09-10T12:00:00.000Z')

  it('свежее событие — «только что»', () => {
    expect(formatAgo('2026-09-10T11:59:30.000Z', now)).toBe('только что')
  })

  it('минуты и часы', () => {
    expect(formatAgo('2026-09-10T11:48:00.000Z', now)).toBe('12 мин назад')
    expect(formatAgo('2026-09-10T09:00:00.000Z', now)).toBe('3 ч назад')
  })

  it('старше суток — дата, относительное уже не помогает', () => {
    const text = formatAgo('2026-09-08T09:00:00.000Z', now)
    expect(text).not.toContain('назад')
    expect(text).toContain('08.09')
  })

  it('время из будущего не даёт отрицательных минут', () => {
    // Часы клиента и сервера расходятся; «-3 мин назад» выглядит поломкой.
    expect(formatAgo('2026-09-10T12:05:00.000Z', now)).toBe('только что')
  })

  it('мусор вместо даты не роняет ленту', () => {
    expect(formatAgo('не дата', now)).toBe('—')
  })
})

describe('разбор ответа RPC', () => {
  it('змеиные имена приводятся к одному виду', () => {
    const pulse = parsePulse({
      visits_daily: [{ day: '2026-09-09', people: 24 }],
      submits_daily: [{ day: '2026-09-09', count: 5 }],
      hourly: [{ hour: 13, events: 9 }],
      week: { visits_this: 110, visits_prev: 23, submits_this: 23, submits_prev: 0 },
      reach: { active_7d: 29, enrolled: 32 },
      visit_days_per_student: 3.4,
      new_students: [{ student_id: 's1', profile_id: 'p1', full_name: 'Ученик', created_at: '2026-09-09' }],
      no_telegram: [{ student_id: 's2', profile_id: 'p2', full_name: 'Другой' }],
    })

    expect(pulse.visitsDaily).toEqual([{ day: '2026-09-09', value: 24 }])
    expect(pulse.submitsDaily).toEqual([{ day: '2026-09-09', value: 5 }])
    expect(pulse.week.visitsThis).toBe(110)
    expect(pulse.reach).toEqual({ active7d: 29, enrolled: 32 })
    expect(pulse.visitDaysPerStudent).toBe(3.4)
    // student_id доезжает отдельно от profile_id: по нему открывается карточка.
    expect(pulse.newStudents[0].studentId).toBe('s1')
    expect(pulse.noTelegram[0].studentId).toBe('s2')
  })

  it('пустой и битый ответ дают пустую панель, а не падение', () => {
    const pulse = parsePulse(null)
    expect(pulse.visitsDaily).toEqual([])
    expect(pulse.hourly).toEqual([])
    expect(pulse.week).toEqual({ visitsThis: 0, visitsPrev: 0, submitsThis: 0, submitsPrev: 0 })
    expect(pulse.newStudents).toEqual([])
  })

  it('лента берёт только известные события', () => {
    const feed = parseFeed([
      { kind: 'submitted', at: '2026-09-09T13:26:00Z', actor_name: 'Рахматуллин', detail: 'Кинематика' },
      { kind: 'enrolled',  at: '2026-09-09T10:43:00Z', actor_name: 'Сафина',      detail: 'Физика 11А' },
      // Неизвестный вид события мы показать не умеем — подпись взять неоткуда.
      { kind: 'exploded',  at: '2026-09-09T10:00:00Z', actor_name: 'Кто-то',      detail: '' },
    ])
    expect(feed.map(e => e.kind)).toEqual(['submitted', 'enrolled'])
    expect(feed[0].actorName).toBe('Рахматуллин')
  })

  it('не массив вместо ленты — пустая лента', () => {
    expect(parseFeed(null)).toEqual([])
    expect(parseFeed({} as any)).toEqual([])
  })
})
