/**
 * §291 «Скорость у ученика» — свой RUM, без внешних SDK.
 *
 * Что пишем (и ничего больше — ни тел, ни фильтров, ни id):
 *   route — сколько ждали вкладку: от смены маршрута до «запросы страницы
 *           завершились и 300 мс тишины». Метка — путь с id → `:id`;
 *   api   — запрос к Supabase: «МЕТОД /rest/v1/<таблица>», «POST /rest/v1/rpc/<функция>»,
 *           «… /storage/v1/object», «POST /functions/v1/<функция>», статус, мс;
 *   nav   — первая загрузка: ttfb, dcl, lcp.
 * Профиль и роль добавляет сервер (`perf_ingest`, auth.uid()). Отправка
 * пачкой раз в 30 с и при уходе со страницы; любые ошибки — молча: RUM не
 * должен мешать ученику.
 */

export type PerfKind = 'route' | 'api' | 'nav'
export interface PerfEvent {
  k: PerfKind
  l: string
  ms: number
  s?: number
  d: 'mobile' | 'desktop'
}

const MAX_QUEUE = 1000
const BATCH = 200
const QUIET_MS = 300
const ROUTE_CAP_MS = 60_000

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function deviceClass(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): 'mobile' | 'desktop' {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop'
}

/** Путь вкладки без id: uuid и числа → `:id`, хвостовой «/» убран. */
export function routeLabel(pathname: string): string {
  const p = pathname
    .replace(UUID_RE, ':id')
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/')
    .replace(/\/+$/, '')
  return (p || '/').slice(0, 120)
}

/**
 * Метка запроса к Supabase или null (не Supabase / сам RUM). Только путь до
 * имени таблицы/функции; query-строка (фильтры с id) отбрасывается.
 */
export function apiLabel(url: string, method: string = 'GET'): string | null {
  let path: string
  try {
    path = new URL(url, 'http://x').pathname
  } catch {
    return null
  }
  const m = method.toUpperCase()
  let label: string | null = null
  let r: RegExpMatchArray | null
  if ((r = path.match(/^\/rest\/v1\/rpc\/([\w-]+)/))) label = `/rest/v1/rpc/${r[1]}`
  else if ((r = path.match(/^\/rest\/v1\/([\w-]+)/))) label = `/rest/v1/${r[1]}`
  else if ((r = path.match(/^\/functions\/v1\/([\w-]+)/))) label = `/functions/v1/${r[1]}`
  else if ((r = path.match(/^\/storage\/v1\/(object\/sign|object\/public|object|bucket)/))) label = `/storage/v1/${r[1]}`
  else if ((r = path.match(/^\/auth\/v1\/(\w+)/))) label = `/auth/v1/${r[1]}`
  if (!label || label === '/rest/v1/rpc/perf_ingest') return null
  return `${m} ${label}`.slice(0, 120)
}

// ── очередь ────────────────────────────────────────────────────────────────

const queue: PerfEvent[] = []
let sampled = true
const device = deviceClass()

export function record(k: PerfKind, l: string, ms: number, s?: number): void {
  if (!sampled || !l || !Number.isFinite(ms) || ms < 0) return
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push(s == null ? { k, l, ms: Math.round(ms), d: device } : { k, l, ms: Math.round(ms), s, d: device })
}

/** Для тестов и отправки: забрать до `n` событий из очереди. */
export function takeBatch(n: number = BATCH): PerfEvent[] {
  return queue.splice(0, n)
}

export function queueSize(): number {
  return queue.length
}

// ── запросы к Supabase и «вкладка готова» ──────────────────────────────────

let inflight = 0
let routeStart: number | null = null
let routeLabelNow = ''
let lastEnd = 0
let quietTimer: ReturnType<typeof setTimeout> | null = null
let sawRequest = false

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function scheduleRouteDone() {
  if (routeStart == null) return
  if (quietTimer) clearTimeout(quietTimer)
  quietTimer = setTimeout(() => {
    quietTimer = null
    if (routeStart == null || inflight > 0) return
    const end = sawRequest ? lastEnd : now()
    record('route', routeLabelNow, Math.min(end - routeStart, ROUTE_CAP_MS))
    routeStart = null
  }, QUIET_MS)
}

/** Смена маршрута: начать отсчёт «сколько ждём вкладку». */
export function routeChanged(pathname: string): void {
  routeStart = now()
  routeLabelNow = routeLabel(pathname)
  sawRequest = false
  scheduleRouteDone()
}

/** Обёртка над fetch клиента Supabase: меряет, ничего не меняет в запросе. */
export function timedFetch(base: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    const label = apiLabel(url, method)
    if (!label) return base(input, init)
    const t0 = now()
    inflight += 1
    if (routeStart != null) sawRequest = true
    let status: number | undefined
    try {
      const res = await base(input, init)
      status = res.status
      return res
    } catch (e) {
      status = 0
      throw e
    } finally {
      const t1 = now()
      inflight = Math.max(0, inflight - 1)
      lastEnd = t1
      record('api', label, t1 - t0, status)
      if (inflight === 0) scheduleRouteDone()
    }
  }
}

// ── отправка ───────────────────────────────────────────────────────────────

export interface RumTransport {
  /** Обычная отправка (RPC perf_ingest). Ошибки глотаются вызывающим. */
  send: (events: PerfEvent[]) => Promise<unknown>
  /** При уходе со страницы: keepalive-запрос (переживает закрытие вкладки). */
  sendOnExit: (events: PerfEvent[]) => void
  /** Есть ли вход: без него не шлём (сервер всё равно вернёт 0). */
  signedIn: () => boolean
}

let started = false

export function startRum(t: RumTransport, opts: { sampleRate?: number; intervalMs?: number } = {}): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  sampled = Math.random() < (opts.sampleRate ?? 1)

  const flush = () => {
    if (!t.signedIn() || queue.length === 0) return
    const batch = takeBatch()
    t.send(batch).catch(() => { /* RUM молчит */ })
  }
  const flushOnExit = () => {
    if (!t.signedIn() || queue.length === 0) return
    try {
      t.sendOnExit(takeBatch())
    } catch {
      /* RUM молчит */
    }
  }
  const onVisibility = () => { if (document.visibilityState === 'hidden') flushOnExit() }

  const timer = setInterval(flush, opts.intervalMs ?? 30_000)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flushOnExit)
  recordNavigationTiming()

  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flushOnExit)
    started = false
  }
}

/** Первая загрузка: TTFB, DOMContentLoaded, LCP (коротко; полные — у Vercel). */
export function recordNavigationTiming(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const label = routeLabel(location.pathname)
    if (nav) {
      if (nav.responseStart > 0) record('nav', `ttfb ${label}`, nav.responseStart)
      const dcl = () => record('nav', `dcl ${label}`, nav.domContentLoadedEventEnd)
      if (nav.domContentLoadedEventEnd > 0) dcl()
      else window.addEventListener('DOMContentLoaded', () => setTimeout(dcl, 0), { once: true })
    }
    if (typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) {
      let lcp = 0
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime)
      })
      po.observe({ type: 'largest-contentful-paint', buffered: true })
      const done = () => {
        po.disconnect()
        if (lcp > 0) record('nav', `lcp ${label}`, lcp)
      }
      // LCP окончательный после первого взаимодействия или ухода
      addEventListener('pointerdown', done, { once: true, capture: true })
      addEventListener('keydown', done, { once: true, capture: true })
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') done() }, { once: true })
    }
  } catch {
    /* RUM молчит */
  }
}

/** Только для тестов: сбросить состояние модуля. */
export function __resetRumForTests(): void {
  queue.length = 0
  inflight = 0
  routeStart = null
  sawRequest = false
  lastEnd = 0
  if (quietTimer) clearTimeout(quietTimer)
  quietTimer = null
  sampled = true
  started = false
}
