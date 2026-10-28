/**
 * §291. Клиентский RUM: метки без id и без параметров, замер запросов и
 * «вкладка готова», отправка только при входе и молча, накладные расходы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRumForTests,
  apiLabel,
  deviceClass,
  noteError,
  noteNav,
  noteUrgentNav,
  noteReload,
  queueSize,
  record,
  routeChanged,
  routeLabel,
  startRum,
  takeBatch,
  timedFetch,
  type RumTransport,
} from '../perf/rum'
import { formatMs, periodRange } from '../perf/perfAdmin'

beforeEach(() => __resetRumForTests())
afterEach(() => { vi.useRealTimers(); __resetRumForTests() })

describe('метки', () => {
  it('routeLabel: uuid и числа → :id, без хвостового «/»', () => {
    expect(routeLabel('/my-course/0b0a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/topic/11111111-2222-4333-8444-555555555555'))
      .toBe('/my-course/:id/topic/:id')
    expect(routeLabel('/catalog/task/12345/')).toBe('/catalog/task/:id')
    expect(routeLabel('/')).toBe('/')
  })
  it('apiLabel: таблица / RPC / функция / storage; без query; сам RUM и чужие адреса — null', () => {
    const base = 'https://p.supabase.co'
    expect(apiLabel(`${base}/rest/v1/topics?select=*&id=eq.abc`, 'get')).toBe('GET /rest/v1/topics')
    expect(apiLabel(`${base}/rest/v1/rpc/student_home_activity`, 'POST')).toBe('POST /rest/v1/rpc/student_home_activity')
    expect(apiLabel(`${base}/functions/v1/subscription-checkout`, 'POST')).toBe('POST /functions/v1/subscription-checkout')
    expect(apiLabel(`${base}/storage/v1/object/sign/topic-materials/abc/def.pdf`, 'POST')).toBe('POST /storage/v1/object/sign')
    expect(apiLabel(`${base}/auth/v1/token?grant_type=refresh_token`, 'POST')).toBe('POST /auth/v1/token')
    expect(apiLabel(`${base}/rest/v1/rpc/perf_ingest`, 'POST')).toBeNull()
    expect(apiLabel('https://example.com/whatever', 'GET')).toBeNull()
  })
  it('deviceClass', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('mobile')
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop')
  })
})

describe('замер', () => {
  it('timedFetch: запрос проходит как есть, событие api со статусом; RUM-отправка не меряется', async () => {
    const base = vi.fn(async () => new Response('{}', { status: 201 }))
    const f = timedFetch(base as unknown as typeof fetch)
    const res = await f('https://p.supabase.co/rest/v1/topic_homework?id=eq.1', { method: 'GET' })
    expect(res.status).toBe(201)
    await f('https://p.supabase.co/rest/v1/rpc/perf_ingest', { method: 'POST' })
    const b = takeBatch()
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ k: 'api', l: 'GET /rest/v1/topic_homework', s: 201 })
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('сбой сети — статус 0, ошибка пробрасывается дальше', async () => {
    const f = timedFetch((async () => { throw new TypeError('net') }) as unknown as typeof fetch)
    await expect(f('https://p.supabase.co/rest/v1/topics')).rejects.toThrow('net')
    expect(takeBatch()[0]).toMatchObject({ k: 'api', s: 0 })
  })

  it('вкладка: от смены маршрута до конца последнего запроса + 300 мс тишины', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const base = vi.fn(() => new Promise<Response>((r) => { release = () => r(new Response('{}')) }))
    const f = timedFetch(base as unknown as typeof fetch)
    routeChanged('/my-course/11111111-2222-4333-8444-555555555555')
    const p = f('https://p.supabase.co/rest/v1/modules')
    await vi.advanceTimersByTimeAsync(1200)
    release()
    await p
    await vi.advanceTimersByTimeAsync(299)
    expect(takeBatch().filter((e) => e.k === 'route')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10)
    const route = takeBatch().find((e) => e.k === 'route')
    expect(route).toMatchObject({ k: 'route', l: '/my-course/:id' })
    expect(route!.ms).toBeGreaterThanOrEqual(1200)
    expect(route!.ms).toBeLessThan(1400)
  })

  it('очередь не растёт бесконечно; накладные расходы < 1 мс на событие', () => {
    const t0 = performance.now()
    for (let i = 0; i < 20_000; i++) record('api', 'GET /rest/v1/topics', i % 500, 200)
    const per = (performance.now() - t0) / 20_000
    expect(per).toBeLessThan(1)
    expect(queueSize()).toBe(1000)
  })
})

describe('отправка', () => {
  it('раз в интервал и при уходе; без входа — не шлём; ошибка отправки — молча', async () => {
    vi.useFakeTimers()
    let signed = false
    const t: RumTransport = {
      signedIn: () => signed,
      send: vi.fn(async () => { throw new Error('сеть') }),
      sendOnExit: vi.fn(),
    }
    const stop = startRum(t, { intervalMs: 1000 })
    record('route', '/catalog', 100)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.send).not.toHaveBeenCalled()
    signed = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.send).toHaveBeenCalledTimes(1)
    record('route', '/homework', 50)
    window.dispatchEvent(new Event('pagehide'))
    expect(t.sendOnExit).toHaveBeenCalledWith([expect.objectContaining({ l: '/homework' })])
    stop()
  })
})

describe('экран «Скорость»: помощники', () => {
  it('formatMs и periodRange', () => {
    expect(formatMs(340)).toBe('340 мс')
    expect(formatMs(1234)).toBe('1,2 с')
    expect(formatMs(20_500)).toBe('21 с')
    expect(formatMs(null)).toBe('—')
    const now = new Date('2026-10-12T21:30:00Z') // 00:30 МСК 13.10
    expect(periodRange('today', now).from).toBe('2026-10-12T21:00:00.000Z')
    expect(periodRange('hour', now).from).toBe('2026-10-12T20:30:00.000Z')
  })
})

describe('диагностика перезагрузок (21.10)', () => {
  beforeEach(() => { localStorage.clear() })

  it('перезагрузка — событие nav «reload <причина> <путь>» сразу keepalive-запросом', () => {
    const t: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(t)
    takeBatch()
    window.history.replaceState(null, '', '/my-course/0c430ec6-1111-2222-3333-444444444444/topic/0c430ec6-1111-2222-3333-555555555555')
    noteReload('chunk:TopicPage')
    expect(t.sendOnExit).toHaveBeenCalledWith([expect.objectContaining({ k: 'nav', l: 'reload chunk:TopicPage /my-course/:id/topic/:id' })])
    expect(localStorage.getItem('rum:pending')).toBeNull()
    stop()
  })

  it('без входа событие ждёт в localStorage и уходит keepalive-запросом, как только вход появился', async () => {
    vi.useFakeTimers()
    noteReload('button:error')
    expect(localStorage.getItem('rum:pending')).toContain('reload button:error')
    let signed = false
    const t: RumTransport = { signedIn: () => signed, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(t)
    // В общую пачку не кладём: вкладку, которую убили раз, часто убивают и второй.
    expect(takeBatch().map(e => e.l).filter(l => l.startsWith('reload'))).toEqual([])
    expect(localStorage.getItem('rum:pending')).toContain('reload button:error')
    signed = true
    await vi.advanceTimersByTimeAsync(1500)
    expect(t.sendOnExit).toHaveBeenCalledWith([expect.objectContaining({ l: expect.stringMatching(/^reload button:error/) })])
    expect(localStorage.getItem('rum:pending')).toBeNull()
    stop()
  })

  it('ошибки страницы — «error <сообщение>», не больше 20 за загрузку; uuid вырезаются', () => {
    const t: RumTransport = { signedIn: () => false, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(t)
    takeBatch()
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('x of 0c430ec6-1111-2222-3333-444444444444 is undefined') }))
    for (let i = 0; i < 30; i++) noteError('loop')
    const labels = takeBatch().map(e => e.l)
    expect(labels[0]).toBe('error TypeError: x of :id is undefined')
    expect(labels.filter(l => l.startsWith('error'))).toHaveLength(20)
    stop()
  })
})

describe('диагностика падений вкладки (письмо 27.10, видео на телефоне)', () => {
  const t = (): RumTransport => ({ signedIn: () => false, send: vi.fn(async () => {}), sendOnExit: vi.fn() })
  const labels = () => takeBatch(1000).filter(e => e.k === 'nav').map(e => e.l)

  it('страница закрылась сама (pagehide) — при следующем старте падения нет', () => {
    window.history.replaceState(null, '', '/my-course/0b0a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/topic/11111111-2222-4333-8444-555555555555')
    let stop = startRum(t())
    window.dispatchEvent(new Event('pagehide'))
    stop()
    expect(localStorage.getItem('rum:alive')).toBeNull()
    takeBatch(1000)
    stop = startRum(t())
    expect(labels().filter(l => l.startsWith('crash'))).toEqual([])
    stop()
  })

  it('отметка осталась (вкладку убили, pagehide не было) — nav «crash <маршрут>» важным событием', () => {
    localStorage.setItem('rum:alive', '/my-course/:id/topic/:id')
    const tr: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(tr)
    expect(tr.sendOnExit).toHaveBeenCalledWith([expect.objectContaining({ k: 'nav', l: 'crash /my-course/:id/topic/:id' })])
    expect(localStorage.getItem('rum:alive')).not.toBeNull()
    stop()
  })

  it('смена маршрута двигает отметку; уход в фон — nav «hide <маршрут>»', () => {
    const stop = startRum(t())
    window.history.replaceState(null, '', '/my-homework')
    routeChanged('/my-homework')
    expect(localStorage.getItem('rum:alive')).toBe('/my-homework')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(labels()).toContain('hide /my-homework')
    stop()
  })

  it('play / play-load / play-ready — сразу keepalive-запросом, без входа ждут в localStorage', () => {
    const tr: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(tr)
    noteUrgentNav('play', '/my-course/abc/topic/11111111-2222-4333-8444-555555555555')
    expect(tr.sendOnExit).toHaveBeenLastCalledWith([expect.objectContaining({ k: 'nav', l: 'play /my-course/abc/topic/:id' })])
    expect(localStorage.getItem('rum:pending')).toBeNull()
    stop()
    noteUrgentNav('play-ready', '/watch/11111111-2222-4333-8444-555555555555')
    expect(localStorage.getItem('rum:pending')).toContain('play-ready /watch/:id')
  })

  it('nav «play <маршрут>» — запуск плеера', () => {
    noteNav('play', '/my-course/abc/topic/11111111-2222-4333-8444-555555555555')
    expect(labels()).toEqual(['play /my-course/abc/topic/:id'])
  })
})

describe('ложный crash (харнесс 27.10)', () => {
  it('повторный startRum в той же загрузке (StrictMode, перемонтирование) падения не сообщает', () => {
    const tr: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    let stop = startRum(tr)
    stop()
    stop = startRum(tr)
    const sentLabels = (tr.sendOnExit as ReturnType<typeof vi.fn>).mock.calls.flat(2).map((e: { l: string }) => e.l)
    expect(sentLabels.filter(l => l.startsWith('crash'))).toEqual([])
    expect(localStorage.getItem('rum:alive')).not.toBeNull()
    stop()
  })
})

describe('защита от шторма важных событий (письмо 28.10)', () => {
  it('одинаковое событие — один раз за загрузку, всего не больше 20 отправок', () => {
    const tr: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(tr)
    ;(tr.sendOnExit as ReturnType<typeof vi.fn>).mockClear()
    for (let i = 0; i < 950; i++) noteUrgentNav('play-ready', '/watch/v1')
    expect(tr.sendOnExit).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 100; i++) noteUrgentNav(`step-${i}`, '/watch/v1')
    expect((tr.sendOnExit as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(20)
    stop()
  })
})
