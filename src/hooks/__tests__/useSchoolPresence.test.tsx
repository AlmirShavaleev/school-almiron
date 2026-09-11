import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'

/**
 * Отметка присутствия и чтение списка.
 *
 * Сторожится суть нового механизма (канал снят, см. `@/lib/schoolPresence`):
 *
 * 1. **Отмечается каждый вошедший**, гость — нет.
 * 2. **В фоне не отмечаемся и не опрашиваем** — требование вводной, а здесь
 *    оно ещё и экономит записи в базу.
 * 3. **Отказ чтения — не «никого нет».** Оба состояния выглядят пустым
 *    списком, и молчание тут соврало бы.
 * 4. **Таймеры снимаются при уходе** — иначе вкладка шлёт отметки вечно.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

let profile: { id: string; role: string } | null = null

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ profile }),
}))

import { useSchoolPresence, useOnlinePeople } from '@/hooks/useSchoolPresence'
import { SchoolPresencePublisher } from '@/components/admin/SchoolPresencePublisher'
import { PRESENCE_WINDOW_S } from '@/lib/schoolPresence'

let hidden = false

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
  profile = { id: 'p-1', role: 'student' }
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('отметка присутствия', () => {
  it('вошедший отмечается сразу при монтировании', async () => {
    renderHook(() => useSchoolPresence())
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('school_presence_touch'))
  })

  it('аргументов у отметки нет: profile_id берётся из auth.uid() в базе', async () => {
    renderHook(() => useSchoolPresence())
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    // Передать профиль аргументом значило бы дать клиенту отметиться за чужого.
    expect(rpc.mock.calls[0]).toEqual(['school_presence_touch'])
  })

  it('гость не отмечается', async () => {
    profile = null
    renderHook(() => useSchoolPresence())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('в фоне отметки не идут, при возврате — идут сразу', async () => {
    hidden = true
    renderHook(() => useSchoolPresence())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(rpc).not.toHaveBeenCalled()

    hidden = false
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rpc).toHaveBeenCalledWith('school_presence_touch')
  })

  it('отметки повторяются по такту, а после ухода прекращаются', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useSchoolPresence())
    expect(rpc).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(rpc).toHaveBeenCalledTimes(2)

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    // Ни одной лишней: иначе закрытая панель слала бы отметки вечно.
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('отказ отметки не роняет приложение', async () => {
    rpc.mockRejectedValue(new Error('нет сети'))
    renderHook(() => useSchoolPresence())
    await new Promise(resolve => setTimeout(resolve, 20))
    // Человек просто пропадёт из списка через 45 секунд — это честнее, чем
    // сломанный экран из-за счётчика присутствия.
    expect(rpc).toHaveBeenCalled()
  })
})

describe('чтение списка онлайн', () => {
  it('спрашивает окно свежести явно', async () => {
    renderHook(() => useOnlinePeople())
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'school_presence_online', { p_seconds: PRESENCE_WINDOW_S },
    ))
  })

  it('раскладывает ответ в людей', async () => {
    rpc.mockResolvedValue({
      data: [{ profile_id: 'p-2', role: 'student', seen_at: '2026-09-11T21:00:00Z' }],
      error: null,
    })
    const { result } = renderHook(() => useOnlinePeople())

    await waitFor(() => expect(result.current.people).toHaveLength(1))
    expect(result.current.people[0]).toEqual({ profileId: 'p-2', role: 'student' })
    expect(result.current.ok).toBe(true)
  })

  it('отказ чтения — это НЕ «никого нет»', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'ONLY_ADMIN_SEES_SCHOOL_STATS' } })
    const { result } = renderHook(() => useOnlinePeople())

    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(result.current.ok).toBe(false)
    expect(result.current.people).toEqual([])
  })

  it('в фоне не опрашиваем', async () => {
    hidden = true
    renderHook(() => useOnlinePeople())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('опрос прекращается при уходе с экрана', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useOnlinePeople())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const before = rpc.mock.calls.length

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(rpc).toHaveBeenCalledTimes(before)
  })

  it('подписки на таблицу не заводим — только опрос', async () => {
    // При отметке раз в 20 секунд на каждого подписка дала бы поток событий
    // ради числа, которое и так обновляется опросом. `supabase.channel` в
    // моке нет вовсе: обращение к нему уронило бы этот тест.
    const { result } = renderHook(() => useOnlinePeople())
    await waitFor(() => expect(result.current.ok).toBe(true))
    expect(rpc.mock.calls.every(c => String(c[0]).startsWith('school_presence'))).toBe(true)
  })
})

describe('SchoolPresencePublisher', () => {
  it('ничего не рисует, но отмечает', async () => {
    const { container } = render(<SchoolPresencePublisher />)
    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('school_presence_touch'))
  })
})
