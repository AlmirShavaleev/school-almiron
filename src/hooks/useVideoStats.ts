import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VideoLesson } from '@/lib/videoStats'

/**
 * Статистика просмотра видеоуроков из Bunny Stream (вкладка «Видео»).
 *
 * Ключ Bunny сюда не попадает: всё считает edge-функция `bunny-video-stats`,
 * она же проверяет права, держит кэш и склеивает ролики с темами и курсами.
 * Хук только нормализует ответ — в компоненте не должно быть разбора чужих
 * форматов.
 *
 * Главное, что нужно помнить про эти числа: **Bunny не знает, КТО смотрел.**
 * Ссылки на видео у нас без токенов, для него все зрители безымянные. Это
 * просмотры всех, у кого была ссылка, а не «ученики посмотрели».
 */

export interface VideoPeriod {
  days:   number
  /** Просмотры за период — из статистики библиотеки, не сумма по роликам. */
  views:  number
  /** Секунды. Единица проверена разведкой на живых ответах. */
  watchSec: number
  /** Сколько точек реально вернул Bunny — окно истории, как в §135. */
  points: number
}

export interface VideoStatsData {
  lessons: VideoLesson[]
  /** Ролики библиотеки, не привязанные ни к одной теме. */
  unattachedInLibrary: number
  /** Всего роликов в библиотеке Bunny. */
  libraryTotal: number
  period: VideoPeriod | null
  fetchedAt: string | null
  fromCache: boolean
  throttled: boolean
  /** Часть запросов к Bunny не прошла: числа неполные. */
  partial: boolean
}

const EMPTY: VideoStatsData = {
  lessons: [], unattachedInLibrary: 0, libraryTotal: 0, period: null,
  fetchedAt: null, fromCache: false, throttled: false, partial: false,
}

function toLesson(row: Record<string, unknown>): VideoLesson {
  return {
    videoId:        String(row.videoId ?? ''),
    topicTitle:     String(row.topicTitle ?? ''),
    bunnyTitle:     String(row.bunnyTitle ?? ''),
    courses:        Array.isArray(row.courses) ? row.courses.map(c => String(c)) : [],
    placements:     Number(row.placements ?? 0),
    onlyInTemplate: row.onlyInTemplate === true,
    missingInBunny: row.missingInBunny === true,
    views:          Number(row.views ?? 0),
    lengthSec:      Number(row.lengthSec ?? 0),
    totalWatchSec:  Number(row.totalWatchSec ?? 0),
    avgWatchSec:    Number(row.avgWatchSec ?? 0),
  }
}

/** Отказ приезжает телом с полем `error` — это НЕ ноль просмотров. */
function refusalMessage(body: Record<string, unknown> | null): string | null {
  if (body && typeof body.error === 'string') {
    return String(body.message ?? 'Статистика видео недоступна')
  }
  return null
}

export function useVideoStats() {
  const [data, setData] = useState<VideoStatsData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [force, setForce] = useState(false)

  const reload = useCallback(() => { setForce(true); setTick(t => t + 1) }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: raw, error: fnErr } = await supabase.functions.invoke('bunny-video-stats', {
        body: force ? { force: true } : {},
      })
      if (cancelled) return

      if (fnErr) {
        // Функция уже перевела отказ на человеческий («ключ отклонён»,
        // «библиотека не найдена»), но при сетевой ошибке сюда придёт голое
        // сообщение.
        setError(fnErr.message || 'Не удалось получить статистику видео')
        setData(EMPTY)
        setLoading(false)
        return
      }

      const body = raw as Record<string, unknown> | null
      const refusal = refusalMessage(body)
      if (refusal) {
        setError(refusal)
        setData(EMPTY)
        setLoading(false)
        return
      }

      const periodRaw = body?.period as Record<string, unknown> | null | undefined
      setData({
        lessons: Array.isArray(body?.lessons)
          ? (body.lessons as Array<Record<string, unknown>>).map(toLesson)
          : [],
        unattachedInLibrary: Number(body?.unattachedInLibrary ?? 0),
        libraryTotal: Number(body?.libraryTotalItems ?? 0),
        period: periodRaw
          ? {
              days:     Number(periodRaw.days ?? 0),
              views:    Number(periodRaw.views ?? 0),
              watchSec: Number(periodRaw.watchTimeRaw ?? 0),
              points:   Number(periodRaw.points ?? 0),
            }
          : null,
        fetchedAt: typeof body?.fetched_at === 'string' ? body.fetched_at : null,
        fromCache: body?.source === 'cache',
        throttled: body?.throttled === true,
        partial:   body?.partial === true,
      })
      setLoading(false)
    }

    load()
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось получить статистику видео')
        setLoading(false)
      })
      .finally(() => { if (!cancelled) setForce(false) })

    return () => { cancelled = true }
    // force намеренно вне зависимостей: он взводится вместе с tick и гасится
    // после запроса, иначе его сброс запускал бы второй заход.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { ...data, loading, error, reload }
}

/**
 * Тепловая карта одного ролика — грузится ПО КЛИКУ, а не пачкой.
 *
 * Карт столько же, сколько роликов (127), а смотрят их по одной. Забирать все
 * вперёд значило бы 127 запросов в Bunny ради одного открытого урока.
 */
export function useVideoHeatmap() {
  const [videoId, setVideoId] = useState<string | null>(null)
  const [heatmap, setHeatmap] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clear = useCallback(() => {
    setVideoId(null)
    setHeatmap(null)
    setError(null)
  }, [])

  const load = useCallback(async (id: string) => {
    setVideoId(id)
    setHeatmap(null)
    setError(null)
    setLoading(true)
    try {
      const { data: raw, error: fnErr } = await supabase.functions.invoke('bunny-video-stats', {
        body: { heatmap: id },
      })
      if (fnErr) {
        setError(fnErr.message || 'Не удалось получить тепловую карту')
        return
      }
      const body = raw as Record<string, unknown> | null
      const refusal = refusalMessage(body)
      if (refusal) {
        setError(refusal)
        return
      }
      const map = body?.heatmap
      setHeatmap(map && typeof map === 'object' ? (map as Record<string, number>) : {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить тепловую карту')
    } finally {
      setLoading(false)
    }
  }, [])

  return { videoId, heatmap, loading, error, load, clear }
}
