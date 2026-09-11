import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * Числа и лента живой панели.
 *
 * Сторожится то, из-за чего живой экран может навредить:
 *
 * 1. **Два запроса на открытие, не больше.** Приёмка просит назвать это число,
 *    а лишний запрос на живом экране множится на каждое открытие вкладки.
 * 2. **Отказ — словами, а не пустой панелью** (уроки §47/§54).
 * 3. **Подписка закрывается при уходе.** Утечка сокетов — растущий счёт.
 * 4. **Лента обновляется перезапросом, а не телом события**: сырая строка не
 *    знает ни имени человека, ни названия темы.
 */

const rpc = vi.fn()
const removeChannel = vi.fn()
const channels: any[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: (topic: string) => {
      const ch: any = { topic, bindings: [] as string[], statusHandler: null, handlers: [] as Array<() => void> }
      ch.on = vi.fn((_type: string, filter: any, handler: () => void) => {
        ch.bindings.push(filter.table)
        ch.handlers.push(handler)
        return ch
      })
      ch.subscribe = vi.fn((handler: (s: string) => void) => {
        ch.statusHandler = handler
        return ch
      })
      channels.push(ch)
      return ch
    },
    removeChannel: (ch: any) => removeChannel(ch.topic),
  },
}))

import { useLivePulse } from '@/hooks/useLivePulse'

const PULSE = {
  visits_daily: [{ day: '2026-09-09', people: 24 }],
  submits_daily: [{ day: '2026-09-09', count: 5 }],
  hourly: [{ hour: 13, events: 9 }],
  week: { visits_this: 110, visits_prev: 23, submits_this: 23, submits_prev: 0 },
  reach: { active_7d: 29, enrolled: 32 },
  visit_days_per_student: 3.4,
  new_students: [],
  no_telegram: [],
}

const FEED = [
  { kind: 'submitted', at: '2026-09-09T13:26:00Z', actor_name: 'Рахматуллин', detail: 'Кинематика' },
]

function okRpc(name: string) {
  if (name === 'admin_live_pulse') return Promise.resolve({ data: PULSE, error: null })
  return Promise.resolve({ data: FEED, error: null })
}

beforeEach(() => {
  rpc.mockReset()
  removeChannel.mockReset()
  channels.length = 0
  rpc.mockImplementation((name: string) => okRpc(name))
})

describe('первая загрузка', () => {
  it('ровно два запроса: числа и лента', async () => {
    const { result } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const names = rpc.mock.calls.map(c => c[0])
    expect(names).toEqual(['admin_live_pulse', 'admin_live_feed'])
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('числа и лента разложены для экрана', async () => {
    const { result } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.pulse?.week.visitsThis).toBe(110)
    expect(result.current.pulse?.reach.enrolled).toBe(32)
    expect(result.current.feed).toHaveLength(1)
    expect(result.current.feed[0].actorName).toBe('Рахматуллин')
    expect(result.current.error).toBeNull()
  })

  it('отказ RPC переводится на человеческий, панель не показывает нули', async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'ONLY_ADMIN_SEES_SCHOOL_STATS' } }))

    const { result } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Живую панель школы видит только администратор')
    expect(result.current.pulse).toBeNull()
    expect(result.current.feed).toEqual([])
  })
})

describe('подписка на изменения', () => {
  it('один канал на все четыре таблицы ленты', async () => {
    const { result } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Четыре канала вместо одного — четыре сокета там, где хватает одного.
    expect(channels).toHaveLength(1)
    expect(channels[0].bindings.sort()).toEqual([
      'group_students', 'topic_homework_attempts', 'topic_homework_reviews', 'topic_section_marks',
    ])
  })

  it('канал закрывается при уходе с экрана', async () => {
    const { result, unmount } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    unmount()
    expect(removeChannel).toHaveBeenCalledWith('school-live-feed')
  })

  it('десять открытий и закрытий — десять каналов, все закрыты', async () => {
    for (let i = 0; i < 10; i++) {
      const { result, unmount } = renderHook(() => useLivePulse())
      await waitFor(() => expect(result.current.loading).toBe(false))
      unmount()
    }
    expect(channels).toHaveLength(10)
    expect(removeChannel).toHaveBeenCalledTimes(10)
  })

  it('отказ подписки не ломает панель, а помечается флагом', async () => {
    const { result } = renderHook(() => useLivePulse())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { channels[0].statusHandler?.('CHANNEL_ERROR') })
    // Лента уже загружена запросом — она просто перестаёт обновляться сама.
    expect(result.current.liveFeed).toBe(false)
    expect(result.current.feed).toHaveLength(1)

    act(() => { channels[0].statusHandler?.('SUBSCRIBED') })
    expect(result.current.liveFeed).toBe(true)
  })

  it('событие вызывает ПЕРЕЗАПРОС ленты, а не разбор своего тела', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useLivePulse())
      await vi.waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()

      // Пачка правок (отметки по рубрикам) схлопывается в один перезапрос.
      act(() => {
        channels[0].handlers.forEach((h: () => void) => h())
        channels[0].handlers.forEach((h: () => void) => h())
      })
      expect(rpc).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })

      expect(rpc.mock.calls.map(c => c[0])).toEqual(['admin_live_feed'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('вкладка в фоне', () => {
  it('пока вкладка скрыта, запросов не шлём', async () => {
    vi.useFakeTimers()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      const { result } = renderHook(() => useLivePulse())
      await vi.waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()

      act(() => { channels[0].handlers[0]() })
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(rpc).not.toHaveBeenCalled()

      // Вернулись на вкладку — догоняем ОДНИМ запросом, а не пачкой.
      hidden.mockReturnValue(false)
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })

      expect(rpc.mock.calls.map(c => c[0])).toEqual(['admin_live_feed'])
    } finally {
      hidden.mockRestore()
      vi.useRealTimers()
    }
  })
})
