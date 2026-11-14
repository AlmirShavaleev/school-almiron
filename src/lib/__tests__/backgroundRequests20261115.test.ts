/**
 * 15.11. Фоновые запросы под нагрузкой (утро 14.11, пул PostgREST исчерпан):
 * отметка визита раз в сутки, профиль не перечитывается на каждое событие,
 * одновременные одинаковые запросы — один, несуществующая RPC — без сети,
 * RUM у доли сессий и без отправки на каждый уход в фон.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_FRESH_MS, claimDailyVisit, moscowDay, shouldReloadProfile } from '../authRefreshPolicy'
import { __inflightSizeForTests, shareInflight } from '../sharedInflight'
import { MISSING_RPC_TTL_MS, __resetMissingRpcForTests, skipMissingRpc } from '../perf/missingRpc'
import { MIN_HIDE_FLUSH_GAP_MS, __resetRumForTests, record, startRum, type RumTransport } from '../perf/rum'
import { RUM_DEFAULT_SAMPLE_RATE, rumSampleRate } from '@/components/perf/RumTracker'

describe('shouldReloadProfile', () => {
  const t0 = Date.parse('2026-11-15T05:00:00Z')
  it('тот же человек, профиль моложе 10 минут — не перечитываем', () => {
    expect(shouldReloadProfile('SIGNED_IN', 'u1', { profileId: 'u1', loadedAt: t0 }, t0 + 60_000)).toBe(false)
    expect(shouldReloadProfile('TOKEN_REFRESHED', 'u1', { profileId: 'u1', loadedAt: t0 }, t0 + PROFILE_FRESH_MS - 1)).toBe(false)
  })
  it('старше 10 минут, другой человек, профиля нет, USER_UPDATED — перечитываем', () => {
    expect(shouldReloadProfile('TOKEN_REFRESHED', 'u1', { profileId: 'u1', loadedAt: t0 }, t0 + PROFILE_FRESH_MS)).toBe(true)
    expect(shouldReloadProfile('SIGNED_IN', 'u2', { profileId: 'u1', loadedAt: t0 }, t0 + 1)).toBe(true)
    expect(shouldReloadProfile('INITIAL_SESSION', 'u1', { profileId: null, loadedAt: 0 }, t0)).toBe(true)
    expect(shouldReloadProfile('USER_UPDATED', 'u1', { profileId: 'u1', loadedAt: t0 }, t0 + 1)).toBe(true)
  })
})

describe('claimDailyVisit', () => {
  function memStorage() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
  }
  it('раз в сутки по Москве на профиль', () => {
    const s = memStorage()
    const morning = Date.parse('2026-11-15T05:00:00Z') // 08:00 МСК
    expect(claimDailyVisit('u1', morning, s)).toBe(true)
    expect(claimDailyVisit('u1', morning + 60_000, s)).toBe(false)
    expect(claimDailyVisit('u2', morning + 60_000, s)).toBe(true)
    // 23:30 МСК того же дня — всё ещё «сегодня»
    expect(claimDailyVisit('u1', Date.parse('2026-11-15T20:30:00Z'), s)).toBe(false)
    // 00:30 МСК следующего дня — новый день, хотя по UTC ещё 15-е
    expect(claimDailyVisit('u1', Date.parse('2026-11-15T21:30:00Z'), s)).toBe(true)
  })
  it('хранилища нет — отмечаем всегда (лишний вызов лучше потерянной отметки)', () => {
    expect(claimDailyVisit('u1', Date.now(), null)).toBe(true)
    expect(claimDailyVisit('u1', Date.now(), null)).toBe(true)
  })
  it('moscowDay — граница суток по Москве', () => {
    expect(moscowDay(Date.parse('2026-11-15T20:59:59Z'))).toBe('2026-11-15')
    expect(moscowDay(Date.parse('2026-11-15T21:00:00Z'))).toBe('2026-11-16')
  })
})

describe('shareInflight', () => {
  it('одновременные вызовы с одним ключом — один запрос; после ответа — снова в сеть', async () => {
    let resolve!: (v: number) => void
    const load = vi.fn(() => new Promise<number>(r => { resolve = r }))
    const a = shareInflight('k', load)
    const b = shareInflight('k', load)
    expect(load).toHaveBeenCalledTimes(1)
    resolve(7)
    expect(await a).toBe(7)
    expect(await b).toBe(7)
    expect(__inflightSizeForTests()).toBe(0)
    const c = shareInflight('k', async () => 8)
    expect(await c).toBe(8)
  })
  it('разные ключи не смешиваются; ошибка расходится всем ждущим и ключ освобождается', async () => {
    const x = shareInflight('a', async () => 'A')
    const y = shareInflight('b', async () => 'B')
    expect(await x).toBe('A')
    expect(await y).toBe('B')
    const fail = () => Promise.reject(new Error('сеть'))
    const p1 = shareInflight('e', fail)
    const p2 = shareInflight('e', fail)
    await expect(p1).rejects.toThrow('сеть')
    await expect(p2).rejects.toThrow('сеть')
    expect(__inflightSizeForTests()).toBe(0)
  })
})

describe('skipMissingRpc', () => {
  beforeEach(() => __resetMissingRpcForTests())
  const url = 'https://p.supabase.co/rest/v1/rpc/my_score_forecast'
  const notFound = () => new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 })

  it('после PGRST202 та же RPC 10 минут отвечает 404 без сети, потом снова идёт в базу', async () => {
    let clock = 1_000
    const base = vi.fn(async () => notFound())
    const f = skipMissingRpc(base as unknown as typeof fetch, () => clock)
    expect((await f(url, { method: 'POST', body: '{}' })).status).toBe(404)
    const cached = await f(url, { method: 'POST', body: '{}' })
    expect(cached.status).toBe(404)
    expect((await cached.json()).code).toBe('PGRST202')
    expect(base).toHaveBeenCalledTimes(1)
    clock += MISSING_RPC_TTL_MS + 1
    await f(url, { method: 'POST', body: '{}' })
    expect(base).toHaveBeenCalledTimes(2)
  })
  it('другие ответы (200, 404 без PGRST202, 504 пула) не запоминаются; другие аргументы не блокируются', async () => {
    const base = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
      init?.body === '{"p_x":1}' ? notFound() : new Response('{"code":"PGRST003"}', { status: 504 }))
    const f = skipMissingRpc(base as unknown as typeof fetch)
    await f(url, { method: 'POST', body: '{}' })
    await f(url, { method: 'POST', body: '{}' })
    expect(base).toHaveBeenCalledTimes(2)
    await f(url, { method: 'POST', body: '{"p_x":1}' })
    await f(url, { method: 'POST', body: '{"p_x":2}' }) // тот же набор имён — заблокирован
    expect(base).toHaveBeenCalledTimes(3)
    await f(url, { method: 'POST', body: '{"p_y":1}' }) // другой набор — идёт в сеть
    expect(base).toHaveBeenCalledTimes(4)
  })
  it('не-RPC запросы проходят как есть', async () => {
    const base = vi.fn(async () => new Response('[]', { status: 404 }))
    const f = skipMissingRpc(base as unknown as typeof fetch)
    await f('https://p.supabase.co/rest/v1/topics?id=eq.1')
    await f('https://p.supabase.co/rest/v1/topics?id=eq.1')
    expect(base).toHaveBeenCalledTimes(2)
  })
})

describe('RUM: доля сессий и уход в фон', () => {
  beforeEach(() => { __resetRumForTests(); localStorage.clear() })
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    __resetRumForTests()
  })
  const hide = () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  }

  it('rumSampleRate: из env 0…1, иначе 20 %', () => {
    expect(rumSampleRate('0.5')).toBe(0.5)
    expect(rumSampleRate('0')).toBe(0)
    expect(rumSampleRate('1')).toBe(1)
    expect(rumSampleRate('')).toBe(RUM_DEFAULT_SAMPLE_RATE)
    expect(rumSampleRate('abc')).toBe(RUM_DEFAULT_SAMPLE_RATE)
    expect(rumSampleRate('2')).toBe(RUM_DEFAULT_SAMPLE_RATE)
    expect(rumSampleRate(undefined)).toBe(RUM_DEFAULT_SAMPLE_RATE)
  })

  it('частые уходы в фон шлют пачку не чаще раза в минуту; закрытие страницы — всегда', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-15T05:00:00Z'))
    const t: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(t, { intervalMs: 10 * 60_000 })
    record('route', '/a', 1)
    hide()
    expect(t.sendOnExit).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(5_000); record('route', '/b', 1); hide() }
    expect(t.sendOnExit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MIN_HIDE_FLUSH_GAP_MS)
    hide()
    expect(t.sendOnExit).toHaveBeenCalledTimes(2)
    record('route', '/c', 1)
    window.dispatchEvent(new Event('pagehide'))
    expect(t.sendOnExit).toHaveBeenCalledTimes(3)
    stop()
  })

  it('сессия вне выборки (sampleRate 0) обычных событий не копит и не шлёт', () => {
    const t: RumTransport = { signedIn: () => true, send: vi.fn(async () => {}), sendOnExit: vi.fn() }
    const stop = startRum(t, { sampleRate: 0 })
    record('route', '/a', 1)
    hide()
    window.dispatchEvent(new Event('pagehide'))
    expect(t.send).not.toHaveBeenCalled()
    expect(t.sendOnExit).not.toHaveBeenCalled()
    stop()
  })
})
