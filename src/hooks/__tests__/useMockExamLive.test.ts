/**
 * §224. Опрос монитора и пинг ученика: когда ходят в базу, а когда молчат.
 * Часы — поддельные; «сейчас» базы совпадает с часами теста (server_now).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const calls: { fn: string; args: Record<string, unknown> }[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'mock_exam_live') {
        return Promise.resolve({ data: { id: 'ex1', title: 'П', group_id: 'g', starts_at: null, ends_at: null, photos_until: null, server_now: new Date().toISOString(), part1_last: 12, students: [] }, error: null })
      }
      return Promise.resolve({ data: { pinged: true }, error: null })
    },
  },
}))

import { LIVE_POLL_MS, useMockExamLive } from '@/hooks/useMockExamLive'
import { MOCK_PING_MS, useMockExamPing } from '@/hooks/useMockExamLesson'

const NOW = new Date('2026-10-18T09:00:00Z').getTime() // 12:00 МСК
const min = 60_000
const win = (startOffsetMin: number, durationMin = 240, graceMin = 15) => {
  const s = NOW + startOffsetMin * min
  return {
    starts_at: new Date(s).toISOString(),
    ends_at: new Date(s + durationMin * min).toISOString(),
    photos_until: new Date(s + (durationMin + graceMin) * min).toISOString(),
  }
}

let visibility: 'visible' | 'hidden' = 'visible'
beforeEach(() => {
  calls.length = 0
  visibility = 'visible'
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => { vi.useRealTimers() })

const count = (fn: string) => calls.filter(c => c.fn === fn).length

describe('useMockExamLive — опрос раз в 20 с', () => {
  it('идёт: сразу и потом каждые 20 с; скрытая вкладка — пропуск; вернулись — сразу', async () => {
    renderHook(() => useMockExamLive('ex1', win(-60)))
    await act(async () => {})
    expect(count('mock_exam_live')).toBe(1)
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS) })
    expect(count('mock_exam_live')).toBe(2)
    visibility = 'hidden'
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 3) })
    expect(count('mock_exam_live')).toBe(2)
    visibility = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(count('mock_exam_live')).toBe(3)
  })

  it('окно закрыто и 15 минут прошли — один раз при открытии, дальше тишина', async () => {
    renderHook(() => useMockExamLive('ex1', win(-300)))
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 5) })
    expect(count('mock_exam_live')).toBe(1)
  })

  it('опрос кончается сам, когда догрузка фото прошла', async () => {
    renderHook(() => useMockExamLive('ex1', win(-254))) // до конца догрузки — 1 минута
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 2) })
    const before = count('mock_exam_live')
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 5) })
    expect(count('mock_exam_live')).toBe(before)
  })

  it('пробник без окна — в базу не ходим', async () => {
    renderHook(() => useMockExamLive('ex1', null))
    await act(async () => { vi.advanceTimersByTime(LIVE_POLL_MS * 2) })
    expect(count('mock_exam_live')).toBe(0)
  })
})

describe('useMockExamPing — «я на странице пробника»', () => {
  it('в окне: при открытии и раз в 30 с; вкладка скрыта — молчит', async () => {
    renderHook(() => useMockExamPing('ex1', win(-10), 0))
    expect(count('mock_exam_ping')).toBe(1)
    expect(calls[0].args).toEqual({ p_mock_exam_id: 'ex1' })
    act(() => { vi.advanceTimersByTime(MOCK_PING_MS) })
    expect(count('mock_exam_ping')).toBe(2)
    visibility = 'hidden'
    act(() => { vi.advanceTimersByTime(MOCK_PING_MS * 3) })
    expect(count('mock_exam_ping')).toBe(2)
  })

  it('до начала — молчит, а в момент начала отмечается сам', () => {
    renderHook(() => useMockExamPing('ex1', win(5), 0))
    expect(count('mock_exam_ping')).toBe(0)
    act(() => { vi.advanceTimersByTime(5 * min + 1000) })
    expect(count('mock_exam_ping')).toBe(1)
  })

  it('после конца окна — ни одного пинга (фото ещё можно, но «пишет» уже нет)', () => {
    renderHook(() => useMockExamPing('ex1', win(-245), 0))
    act(() => { vi.advanceTimersByTime(MOCK_PING_MS * 3) })
    expect(count('mock_exam_ping')).toBe(0)
  })

  it('часы телефона убежали на час вперёд: окно считается по часам базы', () => {
    // Устройство думает, что уже 13:00+4ч, база — что идёт пробник.
    renderHook(() => useMockExamPing('ex1', win(-10), -5 * 3600_000))
    expect(count('mock_exam_ping')).toBe(0)
    renderHook(() => useMockExamPing('ex1', win(-10), 0))
    expect(count('mock_exam_ping')).toBe(1)
  })
})
