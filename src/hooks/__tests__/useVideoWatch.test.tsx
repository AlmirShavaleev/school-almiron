import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { useVideoWatch } from '@/hooks/useVideoWatch'

/**
 * §204. Проводка «плеер → RPC».
 *
 * Плеера здесь нет — есть заглушка, которая шлёт сообщения протокола
 * player.js от имени окна iframe'а. Главная проверка не «сколько посчитали»
 * (это тесты `videoWatch.test.ts`), а что БЕЗ событий не уходит ничего и что
 * накопленное не теряется при паузе и уходе со страницы.
 */

const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) },
}))

const BUNNY = 'https://iframe.mediadelivery.net/embed/726880/0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const YOUTUBE = 'https://www.youtube.com/embed/abc123'

function Player({ embedUrl = BUNNY, enabled = true, itemId = 'm1' }: {
  embedUrl?: string
  enabled?: boolean
  itemId?: string
}) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  useVideoWatch({ itemId, embedUrl, enabled, iframeRef: ref })
  return <iframe ref={ref} src={embedUrl} title="Видео темы" />
}

function timeupdate(iframe: HTMLIFrameElement, seconds: number, duration: number | null = 900) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { context: 'player.js', event: 'timeupdate', value: { seconds, duration } },
      source: iframe.contentWindow,
    }))
  })
}

function playerEvent(iframe: HTMLIFrameElement, event: string) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { context: 'player.js', event, value: null },
      source: iframe.contentWindow,
    }))
  })
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms) })
}

beforeEach(() => {
  rpc.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Счётчик просмотра на странице темы (§204)', () => {
  it('без событий плеера не отправляется ничего — даже за две минуты', () => {
    const { unmount } = render(<Player />)
    advance(120_000)
    unmount()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('вкладка, открытая на видео, сама по себе минут не даёт', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    // Плеер откликнулся, но ролик стоит: позиция не двигается.
    timeupdate(iframe, 0)
    advance(30_000)
    timeupdate(iframe, 0)
    advance(30_000)

    unmount()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('просмотр отправляется при размонтировании — последние секунды не теряются', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    advance(1000); timeupdate(iframe, 1)
    advance(1000); timeupdate(iframe, 2)
    advance(1000); timeupdate(iframe, 3)
    unmount()

    expect(rpc).toHaveBeenCalledWith('video_watch_add', {
      p_item_id: 'm1', p_seconds: 3, p_position: 3, p_duration: 900,
    })
  })

  it('на паузе накопленное уходит сразу, а не ждёт полминуты', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    advance(1000); timeupdate(iframe, 1)
    advance(1000); timeupdate(iframe, 2)
    playerEvent(iframe, 'pause')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('video_watch_add', {
      p_item_id: 'm1', p_seconds: 2, p_position: 2, p_duration: 900,
    })

    rpc.mockClear()
    unmount()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('долгий просмотр уходит по таймеру, порциями не больше 30 секунд', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    for (let i = 1; i <= 25; i++) {
      advance(1000)
      timeupdate(iframe, i)
    }
    advance(5000)

    expect(rpc).toHaveBeenCalledTimes(1)
    const [, payload] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.p_seconds).toBe(25)
    expect(Number(payload.p_seconds)).toBeLessThanOrEqual(30)

    unmount()
  })

  it('YouTube не считается — шов есть, реализации нет', () => {
    const { container, unmount } = render(<Player embedUrl={YOUTUBE} />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    advance(1000); timeupdate(iframe, 1)
    advance(1000); timeupdate(iframe, 2)
    unmount()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('персоналу и в предпросмотре счётчик не цепляется вовсе', () => {
    const { container, unmount } = render(<Player enabled={false} />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    advance(1000); timeupdate(iframe, 1)
    advance(1000); timeupdate(iframe, 2)
    unmount()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('чужое сообщение на странице просмотром не становится', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0)
    advance(1000)
    act(() => {
      // Тот же вид, но без `context` и от другого окна — оба повода отказать.
      window.dispatchEvent(new MessageEvent('message', {
        data: { event: 'timeupdate', value: { seconds: 60, duration: 900 } },
        source: iframe.contentWindow,
      }))
      window.dispatchEvent(new MessageEvent('message', {
        data: { context: 'player.js', event: 'timeupdate', value: { seconds: 60, duration: 900 } },
        source: null,
      }))
    })
    advance(60_000)
    unmount()

    expect(rpc).not.toHaveBeenCalled()
  })

  it('без длительности от плеера отправляем null, а не выдуманный ноль', () => {
    const { container, unmount } = render(<Player />)
    const iframe = container.querySelector('iframe') as HTMLIFrameElement

    timeupdate(iframe, 0, null)
    advance(1000); timeupdate(iframe, 1, null)
    advance(1000); timeupdate(iframe, 2, null)
    unmount()

    expect(rpc).toHaveBeenCalledWith('video_watch_add', {
      p_item_id: 'm1', p_seconds: 2, p_position: 2, p_duration: null,
    })
  })
})
