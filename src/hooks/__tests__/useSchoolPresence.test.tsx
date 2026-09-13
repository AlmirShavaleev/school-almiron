import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'

/**
 * Отметка присутствия и чтение списка.
 *
 * Сторожится суть нового механизма (канал снят, см. `@/lib/schoolPresence`):
 *
 * 1. **Отмечается каждый вошедший**, гость — нет.
 * 2. **В фоне отмечаемся реже и не вечно** (§165): такт 60 с в течение
 *    получаса после последнего действия. Прежнее «в фоне молчим» считало
 *    ушедшим ученика, читающего конспект в соседней вкладке. Список при этом
 *    в фоне не опрашивается — панель смотрит тот, кто на неё смотрит.
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
import { PRESENCE_WINDOW_S, __resetActivityForTests } from '@/lib/schoolPresence'

let hidden = false

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null })
  profile = { id: 'p-1', role: 'student' }
  hidden = false
  __resetActivityForTests()
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

  it('видимая вкладка: такт 20 секунд', async () => {
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())
    expect(rpc).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(rpc).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('в фоне отметки ИДУТ — раз в 60 секунд, ровно полчаса после действия', async () => {
    // Ровно тот случай, ради которого §165 и делался: ученик открыл конспект
    // в новой вкладке и читает. Прежнее правило считало его ушедшим.
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())
    expect(rpc).toHaveBeenCalledTimes(1)

    hidden = true
    // Первые полчаса: по отметке в минуту, а не в 20 секунд.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })
    expect(rpc).toHaveBeenCalledTimes(2)

    const afterFirstMinute = rpc.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    // Десять минут — десять отметок, не тридцать.
    expect(rpc.mock.calls.length - afterFirstMinute).toBe(10)
  })

  it('в фоне после получаса отметки прекращаются', async () => {
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())
    hidden = true

    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000) })
    const atExpiry = rpc.mock.calls.length

    // Вкладка, забытая на ночь, ресурсы не жжёт.
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 60_000) })
    expect(rpc).toHaveBeenCalledTimes(atExpiry)
  })

  it('возвращение на вкладку отмечается сразу и возвращает такт 20 секунд', async () => {
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())
    hidden = true
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * 60_000) })
    const asleep = rpc.mock.calls.length

    hidden = false
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(rpc).toHaveBeenCalledTimes(asleep + 1)

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(rpc).toHaveBeenCalledTimes(asleep + 2)
  })

  it('действие продлевает льготный период', async () => {
    // Открытие материала — это клик на нашей странице, он сюда и попадает.
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())
    hidden = true

    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60_000) })
    // Клик по ссылке материала: период отсчитывается заново.
    await act(async () => { document.dispatchEvent(new Event('pointerdown')) })
    const afterClick = rpc.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    // Без продления здесь было бы молчание: 25 + 10 больше тридцати.
    expect(rpc.mock.calls.length).toBeGreaterThan(afterClick)
  })

  it('уход в фон сам по себе периода не продлевает', async () => {
    vi.useFakeTimers()
    renderHook(() => useSchoolPresence())

    await act(async () => { await vi.advanceTimersByTimeAsync(29 * 60_000) })
    hidden = true
    // Событие видимости приходит и при УХОДЕ в фон. Считать его действием
    // значило бы дать брошенной вкладке продлевать себя самой.
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    const atHide = rpc.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(rpc).toHaveBeenCalledTimes(atHide)
  })

  it('после ухода со страницы отметки прекращаются', async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useSchoolPresence())
    const before = rpc.mock.calls.length

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000) })
    // Ни одной лишней: иначе закрытая панель слала бы отметки вечно.
    expect(rpc).toHaveBeenCalledTimes(before)
    // И слушатели сняты — клик после размонтирования тоже ничего не шлёт.
    await act(async () => { document.dispatchEvent(new Event('pointerdown')) })
    expect(rpc).toHaveBeenCalledTimes(before)
  })

  it('отказ отметки не роняет приложение', async () => {
    rpc.mockRejectedValue(new Error('нет сети'))
    renderHook(() => useSchoolPresence())
    await new Promise(resolve => setTimeout(resolve, 20))
    // Человек просто пропадёт из списка по истечении окна — это честнее, чем
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
