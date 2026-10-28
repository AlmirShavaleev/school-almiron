import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachPlayerJs,
  parsePlayerJsMessage,
  playerJsListenCommand,
  playerJsTime,
  supportsWatchTracking,
  videoProviderOf,
  type PlayerJsEvent,
} from '@/lib/videoPlayerBridge'

/**
 * §204. Приёмник событий плеера.
 *
 * Точную форму сообщений боевого Bunny из облака не проверить — здесь стоит
 * ЗАГЛУШКА, повторяющая протокол player.js по описанию. Поэтому проверяется
 * не «мы правильно поняли Bunny», а оборонительная часть: чужое сообщение
 * игнорируется, сообщение не из того iframe игнорируется, и при отсутствии
 * событий наверх не уходит ничего.
 */

const iframes: HTMLIFrameElement[] = []

function makeIframe(src = 'https://iframe.mediadelivery.net/embed/726880/abc'): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.src = src
  document.body.appendChild(iframe)
  iframes.push(iframe)
  return iframe
}

/** Сообщение «как от плеера»: с указанием окна-источника. */
function post(source: MessageEventSource | null, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin: 'https://iframe.mediadelivery.net' }))
}

afterEach(() => {
  for (const frame of iframes.splice(0)) frame.remove()
})

describe('Разбор сообщений player.js (§204)', () => {
  it('понимает объект и строку с JSON', () => {
    const asObject = parsePlayerJsMessage({ context: 'player.js', event: 'play', value: null })
    const asString = parsePlayerJsMessage('{"context":"player.js","event":"play","value":null}')
    expect(asObject).toEqual({ event: 'play', value: null })
    expect(asString).toEqual({ event: 'play', value: null })
  })

  it('чужое сообщение игнорируется', () => {
    expect(parsePlayerJsMessage({ context: 'vercel-analytics', event: 'play' })).toBeNull()
    expect(parsePlayerJsMessage({ event: 'timeupdate', value: { seconds: 10 } })).toBeNull()
    expect(parsePlayerJsMessage('webpackHotUpdate')).toBeNull()
    expect(parsePlayerJsMessage(null)).toBeNull()
    expect(parsePlayerJsMessage(['player.js'])).toBeNull()
    expect(parsePlayerJsMessage({ context: 'player.js' })).toBeNull()
    expect(parsePlayerJsMessage({ context: 'player.js', event: 42 })).toBeNull()
  })

  it('позиция и длительность читаются, мусор — нет', () => {
    expect(playerJsTime({ seconds: 12.5, duration: 900 })).toEqual({ seconds: 12.5, duration: 900 })
    expect(playerJsTime({ seconds: 12.5 })).toEqual({ seconds: 12.5, duration: null })
    expect(playerJsTime({ seconds: '12.5' })).toBeNull()
    expect(playerJsTime({ duration: 900 })).toBeNull()
    expect(playerJsTime(null)).toBeNull()
  })

  it('команда подписки — тот вид, что ждёт протокол', () => {
    expect(JSON.parse(playerJsListenCommand('timeupdate', 'метка'))).toEqual({
      context: 'player.js', version: '0.0.4', method: 'addEventListener',
      value: 'timeupdate', listener: 'метка',
    })
  })
})

describe('Кого умеем считать (§204)', () => {
  it('Bunny узнаётся и считается', () => {
    expect(videoProviderOf('https://iframe.mediadelivery.net/embed/726880/abc')).toBe('bunny')
    expect(supportsWatchTracking('https://iframe.mediadelivery.net/embed/726880/abc')).toBe(true)
  })

  it('YouTube и Vimeo узнаются, но не считаются — это шов, а не реализация', () => {
    expect(videoProviderOf('https://www.youtube.com/embed/abc')).toBe('youtube')
    expect(videoProviderOf('https://player.vimeo.com/video/123')).toBe('vimeo')
    expect(supportsWatchTracking('https://www.youtube.com/embed/abc')).toBe(false)
    expect(supportsWatchTracking('https://player.vimeo.com/video/123')).toBe(false)
  })

  it('незнакомый и пустой адрес не считаются', () => {
    expect(videoProviderOf('https://rutube.ru/video/abc')).toBe('unknown')
    expect(videoProviderOf('не адрес')).toBe('unknown')
    expect(supportsWatchTracking(null)).toBe(false)
  })
})

describe('Подписка на события конкретного iframe (§204)', () => {
  it('событие из своего iframe доходит', () => {
    const iframe = makeIframe()
    const events: PlayerJsEvent[] = []
    const detach = attachPlayerJs({ iframe, onEvent: e => events.push(e) })

    post(iframe.contentWindow, { context: 'player.js', event: 'timeupdate', value: { seconds: 3, duration: 900 } })

    expect(events).toEqual([{ event: 'timeupdate', value: { seconds: 3, duration: 900 } }])
    detach()
  })

  it('сообщение не из того iframe игнорируется', () => {
    const mine = makeIframe()
    const other = makeIframe('https://iframe.mediadelivery.net/embed/726880/def')
    const events: PlayerJsEvent[] = []
    const detach = attachPlayerJs({ iframe: mine, onEvent: e => events.push(e) })

    post(other.contentWindow, { context: 'player.js', event: 'timeupdate', value: { seconds: 3, duration: 900 } })
    post(null, { context: 'player.js', event: 'timeupdate', value: { seconds: 3, duration: 900 } })

    expect(events).toEqual([])
    detach()
  })

  it('чужое сообщение из своего iframe наверх не уходит', () => {
    const iframe = makeIframe()
    const events: PlayerJsEvent[] = []
    const detach = attachPlayerJs({ iframe, onEvent: e => events.push(e) })

    post(iframe.contentWindow, { type: 'resize', height: 400 })
    post(iframe.contentWindow, 'привет')

    expect(events).toEqual([])
    detach()
  })

  it('после отписки события не приходят', () => {
    const iframe = makeIframe()
    const events: PlayerJsEvent[] = []
    const detach = attachPlayerJs({ iframe, onEvent: e => events.push(e) })
    detach()

    post(iframe.contentWindow, { context: 'player.js', event: 'play', value: null })

    expect(events).toEqual([])
  })

  it('до готовности — подписка только на ready; на ready — одна серия на остальные события', () => {
    const iframe = makeIframe()
    const sent: Array<[unknown, string]> = []
    const win = iframe.contentWindow!
    Object.defineProperty(win, 'postMessage', {
      configurable: true,
      value: (message: unknown, origin: string) => { sent.push([message, origin]) },
    })

    const detach = attachPlayerJs({ iframe, onEvent: () => {} })

    expect(sent.length).toBeGreaterThan(0)
    for (const [message] of sent) {
      expect(JSON.parse(String(message)).context).toBe('player.js')
      expect(JSON.parse(String(message)).method).toBe('addEventListener')
    }
    const values = () => sent.map(([m]) => JSON.parse(String(m)).value)
    expect(new Set(values())).toEqual(new Set(['ready']))

    post(win, { context: 'player.js', event: 'ready', value: null })
    const after = values().slice(values().indexOf('play'))
    expect(after).toEqual(['play', 'pause', 'ended', 'timeupdate'])
    detach()
  })

  it('плеер так и не ответил ready — после всех повторов одна полная серия, дальше тишина', () => {
    vi.useFakeTimers()
    const iframe = makeIframe()
    const values: string[] = []
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage: (m: unknown) => { values.push(JSON.parse(String(m)).value) } },
    })
    const detach = attachPlayerJs({ iframe, onEvent: () => {} })
    vi.advanceTimersByTime(20_000)
    expect(values.filter(v => v === 'timeupdate')).toHaveLength(1)
    expect(values.filter(v => v === 'ready').length).toBeLessThanOrEqual(21)
    const n = values.length
    vi.advanceTimersByTime(10_000)
    expect(values).toHaveLength(n)
    detach()
    vi.useRealTimers()
  })

  it('пока плеер не ответил, команды повторяются; после ready — перестают', () => {
    vi.useFakeTimers()
    const iframe = makeIframe()
    let sent = 0
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: { postMessage: () => { sent += 1 } },
    })
    const detach = attachPlayerJs({ iframe, onEvent: () => {} })

    const afterFirst = sent
    vi.advanceTimersByTime(1500)
    expect(sent).toBeGreaterThan(afterFirst)

    // `ready` приходит не от того окна — повторы не прекращаются.
    window.dispatchEvent(new MessageEvent('message', {
      data: { context: 'player.js', event: 'ready', value: null }, source: null,
    }))
    const beforeReady = sent
    vi.advanceTimersByTime(1500)
    expect(sent).toBeGreaterThan(beforeReady)

    detach()
    const afterDetach = sent
    vi.advanceTimersByTime(5000)
    expect(sent).toBe(afterDetach)
    vi.useRealTimers()
  })
})

describe('цикл ready ↔ addEventListener (письмо 28.10: iPhone убивал вкладку)', () => {
  /**
   * Плеер «как Bunny»: на подписку `ready`, если уже готов, сразу отвечает
   * `ready`; остальные подписки копит. Без защиты мост на каждый `ready`
   * подписывался заново — 950 `ready` за 3 секунды, и iOS убивал страницу.
   */
  function bunnyLikePlayer(iframe: HTMLIFrameElement) {
    const win = iframe.contentWindow!
    const listens: string[] = []
    let sendsWithTimeupdate = 0
    Object.defineProperty(win, 'postMessage', {
      configurable: true,
      value: (message: unknown) => {
        const cmd = JSON.parse(String(message))
        if (cmd.method !== 'addEventListener') return
        listens.push(cmd.value)
        if (cmd.value === 'timeupdate') sendsWithTimeupdate += 1
        if (cmd.value === 'ready') queueMicrotask(() => post(win, { context: 'player.js', event: 'ready', value: null }))
      },
    })
    return { listens, series: () => sendsWithTimeupdate }
  }

  it('за 2 с не больше одного ready наверх и не больше двух серий подписок', async () => {
    vi.useFakeTimers()
    const iframe = makeIframe()
    const player = bunnyLikePlayer(iframe)
    const events: PlayerJsEvent[] = []
    const detach = attachPlayerJs({ iframe, onEvent: e => events.push(e) })
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(100)
    expect(events.filter(e => e.event === 'ready')).toHaveLength(1)
    expect(player.series()).toBeLessThanOrEqual(2)
    expect(player.listens.length).toBeLessThan(20)
    detach()
    vi.useRealTimers()
  })

  it('после ready события плеера доходят по-прежнему, повторный ready — нет', async () => {
    const iframe = makeIframe()
    bunnyLikePlayer(iframe)
    const events: string[] = []
    const detach = attachPlayerJs({ iframe, onEvent: e => events.push(e.event) })
    await new Promise(r => setTimeout(r, 0))
    post(iframe.contentWindow, { context: 'player.js', event: 'ready', value: null })
    post(iframe.contentWindow, { context: 'player.js', event: 'timeupdate', value: { seconds: 3, duration: 60 } })
    expect(events.filter(e => e === 'ready')).toHaveLength(1)
    expect(events).toContain('timeupdate')
    detach()
  })
})
