import { useEffect, useRef, type RefObject } from 'react'
import { supabase } from '@/lib/supabase'
import { attachPlayerJs, playerJsTime, supportsWatchTracking } from '@/lib/videoPlayerBridge'
import {
  createWatchState,
  drainWatchSeconds,
  noteWatchDuration,
  observeWatchTick,
  resetWatchClock,
  type WatchState,
} from '@/lib/videoWatch'

/**
 * Проводка между плеером и счётчиком (§204).
 *
 * Арифметика — в `src/lib/videoWatch.ts`, протокол — в
 * `src/lib/videoPlayerBridge.ts`; здесь только React и отправка. Сам хук
 * ничего не решает про «смотрел или нет»: если плеер молчит, `pendingSec`
 * остаётся нулём и ни одна RPC не уходит. Это и есть обещанная деградация —
 * при непонятном плеере данных не появляется, вместо того чтобы появились
 * выдуманные.
 *
 * Отправляем раз в полминуты и обязательно на паузе, на конце ролика, при
 * уходе со страницы и при размонтировании: последние минуты сеанса — самые
 * частые, терять их значит систематически занижать каждого ученика.
 *
 * `supabase as any`: `video_watch_add` заведена миграцией §204, а
 * `src/types/database.ts` генерируется MCP по проду и отстаёт — руками типы
 * не дописываем (CLAUDE.md).
 */

export const WATCH_FLUSH_MS = 30_000

export interface VideoWatchProgress {
  maxPositionSec: number
  durationSec: number | null
}

export interface UseVideoWatchOptions {
  itemId: string
  /** Адрес плеера. Не Bunny — счётчик не цепляется вовсе (шов, §204). */
  embedUrl: string | null
  /** Считать ли: ученик — да, персонал и предпросмотр — нет. */
  enabled: boolean
  iframeRef: RefObject<HTMLIFrameElement | null>
  /** Докуда дошёл прямо сейчас — чтобы отметка «просмотрено» не ждала перезагрузки. */
  onProgress?: (progress: VideoWatchProgress) => void
}

export function useVideoWatch({ itemId, embedUrl, enabled, iframeRef, onProgress }: UseVideoWatchOptions): void {
  // Через ref, а не напрямую: иначе смена обработчика пересобирала бы подписку
  // на плеер, и накопленные секунды терялись бы на каждом рендере родителя.
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  useEffect(() => {
    if (!enabled || !itemId || !supportsWatchTracking(embedUrl)) return
    const iframe = iframeRef.current
    if (!iframe) return

    let state: WatchState = createWatchState()
    // До первого явного `pause` считаем, что плеер играет: прибавку всё равно
    // даёт только сдвинувшаяся позиция, а ждать `play`, которого может не
    // быть в этой сборке плеера, значит не посчитать ничего.
    let playing = true
    let closed = false

    const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

    function report() {
      onProgressRef.current?.({ maxPositionSec: state.maxPositionSec, durationSec: state.durationSec })
    }

    function flush() {
      const drained = drainWatchSeconds(state)
      state = drained.state
      if (drained.chunks.length === 0) return

      const position = Math.round(state.maxPositionSec)
      const duration = state.durationSec == null ? null : Math.round(state.durationSec)
      for (const seconds of drained.chunks) {
        // Ошибку глушим молча: подсчёт не имеет права мешать ученику смотреть
        // — ни отказом прав, ни отсутствием самой функции, пока её не завели.
        void (supabase as unknown as { rpc: (n: string, a: unknown) => PromiseLike<unknown> })
          .rpc('video_watch_add', {
            p_item_id: itemId,
            p_seconds: seconds,
            p_position: position,
            p_duration: duration,
          })
          .then(() => undefined, () => undefined)
      }
    }

    const detach = attachPlayerJs({
      iframe,
      onEvent: event => {
        if (closed) return
        switch (event.event) {
          case 'play':
            playing = true
            state = resetWatchClock(state)
            break
          case 'pause':
          case 'ended':
            playing = false
            state = resetWatchClock(state)
            flush()
            break
          case 'timeupdate': {
            const time = playerJsTime(event.value)
            if (!time) return
            state = noteWatchDuration(state, time.duration)
            state = observeWatchTick(state, {
              atMs: Date.now(),
              positionSec: time.seconds,
              playing,
              visible: isVisible(),
            })
            report()
            break
          }
          default:
            break
        }
      },
    })

    function handleVisibility() {
      if (isVisible()) return
      state = resetWatchClock(state)
      flush()
    }
    function handlePageHide() {
      state = resetWatchClock(state)
      flush()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    const timer = setInterval(flush, WATCH_FLUSH_MS)

    return () => {
      flush()
      closed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      detach()
    }
  }, [enabled, itemId, embedUrl, iframeRef])
}
