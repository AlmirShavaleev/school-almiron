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
    expect(result.current.lessons).toHaveLength(1)
    expect(result.current.lessons[0].topicTitle).toBe('Векторы')
    expect(result.current.lessons[0].views).toBe(11)
    expect(result.current.unattachedInLibrary).toBe(54)
    expect(result.current.libraryTotal).toBe(181)
    // watchTimeRaw → watchSec: единица (секунды) проверена разведкой.
    expect(result.current.period).toEqual({ days: 30, views: 19, watchSec: 5154, points: 31 })
    expect(result.current.fromCache).toBe(false)
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
    expect(result.current.lessons).toEqual([])
    expect(result.current.period).toBeNull()
  })

  it('сетевая ошибка тоже даёт сообщение, а не пустую таблицу', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to fetch')
    expect(result.current.lessons).toEqual([])
  })

  it('признаки кэша и троттлинга доезжают до экрана', async () => {
    invoke.mockResolvedValue({
      data: { ...OK_BODY, source: 'cache', throttled: true },
      error: null,
    })
    const { result } = renderHook(() => useVideoStats())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.fromCache).toBe(true)
    expect(result.current.throttled).toBe(true)
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
