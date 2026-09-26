import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * Хук вкладки «Видео»: разбор ответа edge-функции `bunny-video-stats`.
 *
 * Главное, что здесь сторожится, — **отказ не должен превращаться в нули**.
 * Функция переводит отказы Bunny на человеческий и присылает их ТЕЛОМ с полем
 * `error`, то есть с кодом 200. Если хук такой ответ не распознает, экран
 * покажет «0 просмотров» вместо «ключ отклонён» — то самое враньё нулём, из-за
 * которого в §135 пришлось выравнивать границы суток.
 */

const invoke = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

import { useVideoStats, useVideoHeatmap } from '@/hooks/useVideoStats'

const OK_BODY = {
  lessons: [
    {
      videoId: 'a', topicTitle: 'Векторы', bunnyTitle: '№2 Видеоконспект_Векторы',
      courses: ['Математика 11А'], placements: 3, onlyInTemplate: false,
      missingInBunny: false, views: 11, lengthSec: 1159,
      totalWatchSec: 1969, avgWatchSec: 179,
    },
  ],
  unattachedInLibrary: 54,
  libraryTotalItems: 181,
  period: { days: 30, views: 19, watchTimeRaw: 5154, points: 31 },
  fetched_at: '2026-09-09T10:00:00.000Z',
  source: 'bunny',
  partial: false,
}

beforeEach(() => {
  invoke.mockReset()
})

describe('useVideoStats', () => {
  it('раскладывает ответ функции в готовые для экрана числа', async () => {
    invoke.mockResolvedValue({ data: OK_BODY, error: null })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    // Прежний вид ответа (функция до §232) — одна библиотека, математика.
    expect(result.current.libraries).toHaveLength(1)
    const math = result.current.libraries[0]
    expect(math).toMatchObject({ id: '726880', label: 'Математика', primary: true, status: 'ok' })
    expect(math.lessons).toHaveLength(1)
    expect(math.lessons[0].topicTitle).toBe('Векторы')
    expect(math.lessons[0].views).toBe(11)
    expect(math.unattachedInLibrary).toBe(54)
    expect(math.libraryTotal).toBe(181)
    // watchTimeRaw → watchSec: единица (секунды) проверена разведкой.
    expect(math.period).toEqual({ days: 30, views: 19, watchSec: 5154, points: 31 })
    expect(math.fromCache).toBe(false)
  })

  it('отказ телом (200 + error) показывается словами, а не нулями', async () => {
    invoke.mockResolvedValue({
      data: { error: 'bad_key', message: 'Bunny отклонил ключ: он недействителен…' },
      error: null,
    })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toContain('Bunny отклонил ключ')
    // Числа обнуляются НАМЕРЕННО, но экран показывает ошибку, а не таблицу.
    expect(result.current.libraries).toEqual([])
  })

  it('сетевая ошибка тоже даёт сообщение, а не пустую таблицу', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to fetch')
    expect(result.current.libraries).toEqual([])
  })

  it('признаки кэша и троттлинга доезжают до экрана', async () => {
    invoke.mockResolvedValue({
      data: { ...OK_BODY, source: 'cache', throttled: true },
      error: null,
    })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.libraries[0].fromCache).toBe(true)
    expect(result.current.libraries[0].throttled).toBe(true)
  })

  it('первый заход идёт без force, «Обновить» — с force', async () => {
    invoke.mockResolvedValue({ data: OK_BODY, error: null })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenLastCalledWith('bunny-video-stats', { body: {} })

    await act(async () => { result.current.reload() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenLastCalledWith('bunny-video-stats', { body: { force: true } })
  })
})

describe('useVideoStats — несколько библиотек (§232)', () => {
  const MULTI = {
    // Основная упала: верхний уровень несёт её отказ для прежнего клиента.
    error: 'bad_key', message: 'Bunny отклонил ключ библиотеки «Математика» (726880)…',
    libraries: [
      { id: '726880', label: 'Математика', primary: true, status: 'error', error: 'bad_key',
        message: 'Bunny отклонил ключ библиотеки «Математика» (726880)…', attachedVideos: 127 },
      { ...OK_BODY, id: '763334', label: 'Физика', primary: false, status: 'ok', attachedVideos: 1, source: 'cache' },
    ],
    unknownLibraries: [{ libraryId: '111111', videos: 2 }],
  }

  it('библиотеки разбираются по отдельности; отказ основной — не отказ всей вкладки', async () => {
    invoke.mockResolvedValue({ data: MULTI, error: null })
    const { result } = renderHook(() => useVideoStats())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    const [math, phys] = result.current.libraries
    expect(math).toMatchObject({ id: '726880', status: 'error', attachedVideos: 127, lessons: [] })
    expect(math.message).toContain('Bunny отклонил ключ')
    expect(phys).toMatchObject({ id: '763334', label: 'Физика', status: 'ok', fromCache: true, message: null })
    expect(phys.lessons[0].topicTitle).toBe('Векторы')
    expect(result.current.unknownLibraries).toEqual([{ libraryId: '111111', videos: 2 }])
  })

  it('«ключ не задан» доезжает статусом not_configured, а не ошибкой', async () => {
    invoke.mockResolvedValue({
      data: {
        ...OK_BODY,
        libraries: [
          { ...OK_BODY, id: '726880', label: 'Математика', primary: true, status: 'ok' },
          { id: '763334', label: 'Физика', primary: false, status: 'not_configured', error: 'not_configured',
            message: 'Ключ библиотеки физики не задан (BUNNY_PHYSICS_API_KEY).', attachedVideos: 58 },
        ],
      },
      error: null,
    })
    const { result } = renderHook(() => useVideoStats())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.libraries[1]).toMatchObject({
      status: 'not_configured', attachedVideos: 58, message: 'Ключ библиотеки физики не задан (BUNNY_PHYSICS_API_KEY).',
    })
  })

  it('не-2xx функции (нет прав): причина берётся из тела, а не «non-2xx status code»', async () => {
    const context = { json: async () => ({ error: 'forbidden', message: 'Статистику просмотра видео видит только администратор.' }) }
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }),
    })
    const { result } = renderHook(() => useVideoStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Статистику просмотра видео видит только администратор.')
  })
})

describe('useVideoHeatmap', () => {
  it('карта грузится только по запросу, а не вместе со списком', async () => {
    const { result } = renderHook(() => useVideoHeatmap())

    // Ничего не смонтировав сверх этого, в функцию не ходим: карт 127, а
    // смотрят их по одной.
    expect(invoke).not.toHaveBeenCalled()
    expect(result.current.heatmap).toBeNull()

    invoke.mockResolvedValue({ data: { videoId: 'a', heatmap: { '0': 100 } }, error: null })
    await act(async () => { await result.current.load('a') })

    expect(invoke).toHaveBeenCalledWith('bunny-video-stats', { body: { heatmap: 'a' } })
    expect(result.current.heatmap).toEqual({ '0': 100 })
    expect(result.current.videoId).toBe('a')
  })

  it('карта ролика физики просится у библиотеки физики', async () => {
    invoke.mockResolvedValue({ data: { videoId: 'p', library: '763334', heatmap: { '0': 100 } }, error: null })
    const { result } = renderHook(() => useVideoHeatmap())
    await act(async () => { await result.current.load('p', '763334') })
    expect(invoke).toHaveBeenCalledWith('bunny-video-stats', { body: { heatmap: 'p', library: '763334' } })
    expect(result.current.heatmap).toEqual({ '0': 100 })
  })

  it('отказ по карте показывается словами', async () => {
    invoke.mockResolvedValue({
      data: { error: 'upstream', message: 'Bunny ответил ошибкой (500).' },
      error: null,
    })
    const { result } = renderHook(() => useVideoHeatmap())

    await act(async () => { await result.current.load('a') })

    expect(result.current.error).toContain('Bunny ответил ошибкой')
    expect(result.current.heatmap).toBeNull()
  })

  it('clear убирает выбранный ролик и его карту', async () => {
    invoke.mockResolvedValue({ data: { videoId: 'a', heatmap: { '0': 100 } }, error: null })
    const { result } = renderHook(() => useVideoHeatmap())

    await act(async () => { await result.current.load('a') })
    expect(result.current.videoId).toBe('a')

    act(() => { result.current.clear() })
    expect(result.current.videoId).toBeNull()
    expect(result.current.heatmap).toBeNull()
  })
})
