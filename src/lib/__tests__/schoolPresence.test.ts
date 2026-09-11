import { describe, expect, it } from 'vitest'
import {
  PRESENCE_POLL_MS, PRESENCE_TOUCH_MS, PRESENCE_WINDOW_S,
  parseOnline, samePeople,
} from '@/lib/schoolPresence'

/**
 * Присутствие через отметки в таблице.
 *
 * Канал Realtime снят: чтобы отметиться в нём, клиенту нужно право читать его,
 * а читать список владелец разрешил только админу. Здесь сторожится то, что
 * осталось чистой логикой.
 */

describe('согласованность сроков', () => {
  it('окно свежести шире такта отметки, но не вдвое', () => {
    // 45 при отметке раз в 20: один потерянный удар не выкидывает человека из
    // списка (20 < 45), а закрытая вкладка пропадает быстро (45 < 60).
    expect(PRESENCE_WINDOW_S * 1000).toBeGreaterThan(PRESENCE_TOUCH_MS)
    expect(PRESENCE_WINDOW_S * 1000).toBeLessThan(PRESENCE_TOUCH_MS * 3)
  })

  it('опрос списка не реже отметок — иначе экран отставал бы на такт', () => {
    expect(PRESENCE_POLL_MS).toBeLessThanOrEqual(PRESENCE_TOUCH_MS)
  })

  it('обещание экрана — 45 секунд, а не «полминуты» из вводной', () => {
    // Приёмка поправлена сознательно: при отметке раз в 20 честный срок
    // исчезновения — 45 секунд, и обещать полминуты значило бы соврать.
    expect(PRESENCE_WINDOW_S).toBe(45)
  })
})

describe('разбор ответа RPC', () => {
  it('берёт идентификатор и роль', () => {
    const people = parseOnline([
      { profile_id: 'p-1', role: 'student', seen_at: '2026-09-11T21:00:00Z' },
      { profile_id: 'p-2', role: 'teacher', seen_at: '2026-09-11T21:00:01Z' },
    ])
    expect(people).toEqual([
      { profileId: 'p-1', role: 'student' },
      { profileId: 'p-2', role: 'teacher' },
    ])
  })

  it('имени в ответе нет и не ожидается — его подставляет экран', () => {
    const people = parseOnline([{ profile_id: 'p-1', role: 'student', full_name: 'Кто-то' }])
    expect(Object.keys(people[0]).sort()).toEqual(['profileId', 'role'])
  })

  it('битые строки и не массив не роняют разбор', () => {
    expect(parseOnline([{ profile_id: '' }, null, { role: 'student' }])).toEqual([])
    expect(parseOnline(null)).toEqual([])
    expect(parseOnline({} as any)).toEqual([])
  })

  it('повтор одного человека схлопывается', () => {
    const people = parseOnline([
      { profile_id: 'p-1', role: 'student' },
      { profile_id: 'p-1', role: 'student' },
    ])
    expect(people).toHaveLength(1)
  })
})

describe('сравнение составов', () => {
  it('тот же состав — не повод перерисовывать', () => {
    // При опросе раз в 15 секунд у людей меняется только `seen_at`, а он на
    // экран не идёт: перерисовка была бы холостой.
    const a = [{ profileId: 'p-1', role: 'student' }]
    const b = [{ profileId: 'p-1', role: 'student' }]
    expect(samePeople(a, b)).toBe(true)
  })

  it('смена состава и смена роли замечаются', () => {
    const base = [{ profileId: 'p-1', role: 'student' }]
    expect(samePeople(base, [{ profileId: 'p-2', role: 'student' }])).toBe(false)
    expect(samePeople(base, [{ profileId: 'p-1', role: 'teacher' }])).toBe(false)
    expect(samePeople(base, [])).toBe(false)
    expect(samePeople(base, [...base, { profileId: 'p-2', role: 'admin' }])).toBe(false)
  })
})
