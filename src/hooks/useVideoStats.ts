import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { VideoLesson } from '@/lib/videoStats'
import { BUNNY_DEFAULT_LIBRARY_ID } from '@/lib/bunnyVideoUrl'

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

/**
 * Состояние библиотеки (§232).
 *   `ok`             — числа есть;
 *   `not_configured` — дополнительной библиотеке не дали ключ: спокойная
 *                      пометка, не поломка;
 *   `error`          — Bunny отказал (ключ, номер библиотеки, сеть) — словами.
 */
export type VideoLibraryStatus = 'ok' | 'not_configured' | 'error'

/** Числа одной библиотеки Bunny: математика и физика живут в разных. */
export interface VideoLibraryStats {
  id:      string
  /** «Математика», «Физика» — подпись переключателя. */
  label:   string
  primary: boolean
  status:  VideoLibraryStatus
  /** Текст пометки или отказа; у `ok` — null. */
  message: string | null
  /** Сколько разных роликов этой библиотеки привязано к темам (по адресам). */
  attachedVideos: number
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

export interface VideoStatsData {
  libraries: VideoLibraryStats[]
  /**
   * Материалы ссылаются на библиотеку, которой функция не знает (нет в
   * секретах). Показываются строкой, а не прячутся и не приписываются чужой.
   */
  unknownLibraries: Array<{ libraryId: string; videos: number }>
}

const EMPTY: VideoStatsData = { libraries: [], unknownLibraries: [] }

/** Подпись основной библиотеки, если функция ответила прежним (до §232) видом. */
const LEGACY_PRIMARY = { id: BUNNY_DEFAULT_LIBRARY_ID, label: 'Математика', primary: true }

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

function toPeriod(raw: unknown): VideoPeriod | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  return {
    days:     Number(p.days ?? 0),
    views:    Number(p.views ?? 0),
    watchSec: Number(p.watchTimeRaw ?? 0),
    points:   Number(p.points ?? 0),
  }
}

/** Числа библиотеки из куска ответа — одинаково для нового и прежнего вида. */
function toLibrary(
  row: Record<string, unknown>,
  ident: { id: string; label: string; primary: boolean },
): VideoLibraryStats {
  const status: VideoLibraryStatus =
    row.status === 'not_configured' ? 'not_configured'
      : row.status === 'error' ? 'error'
        : 'ok'
  const lessons = Array.isArray(row.lessons)
    ? (row.lessons as Array<Record<string, unknown>>).map(toLesson)
    : []
  return {
    ...ident,
    status,
    message: status === 'ok' ? null : String(row.message ?? 'Статистика библиотеки недоступна'),
    attachedVideos: Number(row.attachedVideos ?? new Set(lessons.map(l => l.videoId)).size),
    lessons,
    unattachedInLibrary: Number(row.unattachedInLibrary ?? 0),
    libraryTotal: Number(row.libraryTotalItems ?? 0),
    period: toPeriod(row.period),
    fetchedAt: typeof row.fetched_at === 'string' ? row.fetched_at : null,
    fromCache: row.source === 'cache',
    throttled: row.throttled === true,
    partial:   row.partial === true,
  }
}

/**
 * Ответ функции → библиотеки. Новый вид (§232) — массив `libraries`;
 * прежний — одна библиотека на верхнем уровне (функция ещё не выкачена).
 */
export function parseVideoStats(body: Record<string, unknown> | null): VideoStatsData {
  if (body && Array.isArray(body.libraries)) {
    const libraries = (body.libraries as Array<Record<string, unknown>>).map(row => toLibrary(row, {
      id:      String(row.id ?? ''),
      label:   String(row.label ?? row.id ?? ''),
      primary: row.primary === true,
    }))
    const unknownLibraries = Array.isArray(body.unknownLibraries)
      ? (body.unknownLibraries as Array<Record<string, unknown>>).map(u => ({
          libraryId: String(u.libraryId ?? ''),
          videos:    Number(u.videos ?? 0),
        }))
      : []
    return { libraries, unknownLibraries }
  }
  return { libraries: [toLibrary(body ?? {}, LEGACY_PRIMARY)], unknownLibraries: [] }
}

/**
 * Отказ всей функции приезжает телом с полем `error` — это НЕ ноль просмотров.
 * В новом виде `error` на верхнем уровне относится к основной библиотеке
 * (для прежнего клиента), а не ко всей функции — его разбирает `libraries`.
 */
function refusalMessage(body: Record<string, unknown> | null): string | null {
  if (body && typeof body.error === 'string' && !Array.isArray(body.libraries)) {
    return String(body.message ?? 'Статистика видео недоступна')
  }
  return null
}

/**
 * На не-2xx supabase-js кладёт в `error` только «non-2xx status code», а
 * причина («видит только администратор») лежит телом ответа. Тот же приём,
 * что в `rewriteComment.ts`.
 */
async function functionErrorMessage(fnError: unknown, fallback: string): Promise<string> {
  const err = fnError as { message?: string; context?: { json?: () => Promise<unknown> } }
  const res = err?.context
  if (res && typeof res.json === 'function') {
    try {
      const body = await res.json() as { message?: unknown } | null
      if (body && typeof body.message === 'string' && body.message) return body.message
    } catch {
      // тело не JSON — остаётся общая формулировка
    }
  }
  return err?.message || fallback
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
        const message = await functionErrorMessage(fnErr, 'Не удалось получить статистику видео')
        if (cancelled) return
        setError(message)
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

      setData(parseVideoStats(body))
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

  /**
   * `libraryId` — библиотека ролика (§232): карта физики лежит в библиотеке
   * физики и читается её ключом. Без номера функция берёт основную.
   */
  const load = useCallback(async (id: string, libraryId?: string) => {
    setVideoId(id)
    setHeatmap(null)
    setError(null)
    setLoading(true)
    try {
      const { data: raw, error: fnErr } = await supabase.functions.invoke('bunny-video-stats', {
        body: libraryId ? { heatmap: id, library: libraryId } : { heatmap: id },
      })
      if (fnErr) {
        setError(await functionErrorMessage(fnErr, 'Не удалось получить тепловую карту'))
        return
      }
      const body = raw as Record<string, unknown> | null
      if (body && typeof body.error === 'string') {
        setError(String(body.message ?? 'Не удалось получить тепловую карту'))
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
