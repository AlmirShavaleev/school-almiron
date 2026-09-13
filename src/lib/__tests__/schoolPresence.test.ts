import { describe, expect, it } from 'vitest'
import {
  PRESENCE_BACKGROUND_TOUCH_MS, PRESENCE_GRACE_MS, PRESENCE_POLL_MS,
  PRESENCE_TOUCH_MS, PRESENCE_WINDOW_S,
  parseOnline, samePeople, shouldTouch,
} from '@/lib/schoolPresence'

/**
 * Присутствие через отметки в таблице.
 *
 * Канал Realtime снят: чтобы отметиться в нём, клиенту нужно право читать его,
 * а читать список владелец разрешил только админу. Здесь сторожится то, что
 * осталось чистой логикой.
 */

describe('согласованность сроков', () => {
  it('окно свежести равно льготному периоду — иначе подпись экрана соврёт', () => {
    // Экран пишет «активны за последние 30 минут». Если окно и период
    // разойдутся, подпись начнёт описывать не то, что показано.
    expect(PRESENCE_WINDOW_S * 1000).toBe(PRESENCE_GRACE_MS)
    expect(PRESENCE_WINDOW_S).toBe(30 * 60)
  })

  it('опрос списка не реже отметок — иначе экран отставал бы на такт', () => {
    expect(PRESENCE_POLL_MS).toBeLessThanOrEqual(PRESENCE_TOUCH_MS)
  })

  it('в фоне такт реже, чем на переднем плане', () => {
    expect(PRESENCE_BACKGROUND_TOUCH_MS).toBeGreaterThan(PRESENCE_TOUCH_MS)
  })

  it('окно свежести много шире такта — потерянный удар не выкидывает из списка', () => {
    expect(PRESENCE_WINDOW_S * 1000).toBeGreaterThan(PRESENCE_BACKGROUND_TOUCH_MS * 2)
  })
})

describe('shouldTouch — когда отмечаться', () => {
  const T0 = 1_000_000

  it('видимая вкладка: такт 20 секунд', () => {
    const base = { hidden: false, lastTouchAt: T0, lastActivityAt: T0 }
    expect(shouldTouch(T0 + 19_000, base)).toBe(false)
    expect(shouldTouch(T0 + 20_000, base)).toBe(true)
  })

  it('фон в льготный период: такт 60 секунд, а не 20', () => {
    // Ученик читает PDF в соседней вкладке. Он присутствует, но обновлять
    // его отметку так же часто незачем.
    const base = { hidden: true, lastTouchAt: T0, lastActivityAt: T0 }
    expect(shouldTouch(T0 + 20_000, base)).toBe(false)
    expect(shouldTouch(T0 + 59_000, base)).toBe(false)
    expect(shouldTouch(T0 + 60_000, base)).toBe(true)
  })

  it('фон после льготного периода: молчим, сколько бы ни ждали', () => {
    // Вкладка, забытая на ночь, не должна держать человека «в школе».
    const stale = { hidden: true, lastActivityAt: T0 }
    const now = T0 + PRESENCE_GRACE_MS
    expect(shouldTouch(now, { ...stale, lastTouchAt: now - 60_000 })).toBe(false)
    expect(shouldTouch(now + 3_600_000, { ...stale, lastTouchAt: T0 })).toBe(false)
  })

  it('граница периода: за миг до истечения — ещё да, ровно в срок — уже нет', () => {
    const at = (delta: number) => shouldTouch(T0 + PRESENCE_GRACE_MS + delta, {
      hidden: true, lastTouchAt: 0, lastActivityAt: T0,
    })
    expect(at(-1)).toBe(true)
    expect(at(0)).toBe(false)
  })

  it('видимая вкладка отмечается даже без свежих действий', () => {
    // Человек смотрит видео на странице и ничего не нажимает — он всё равно
    // здесь. Льготный период сторожит ТОЛЬКО фон.
    expect(shouldTouch(T0 + 20_000, {
      hidden: false, lastTouchAt: T0, lastActivityAt: T0 - PRESENCE_GRACE_MS * 10,
    })).toBe(true)
  })

  it('первая отметка уходит сразу, без ожидания такта', () => {
    expect(shouldTouch(T0, { hidden: false, lastTouchAt: 0, lastActivityAt: T0 })).toBe(true)
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
