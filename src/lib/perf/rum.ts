/**
 * §291 «Скорость у ученика» — свой RUM, без внешних SDK.
 *
 * Что пишем (и ничего больше — ни тел, ни фильтров, ни id):
 *   route — сколько ждали вкладку: от смены маршрута до «запросы страницы
 *           завершились и 300 мс тишины». Метка — путь с id → `:id`;
 *   api   — запрос к Supabase: «МЕТОД /rest/v1/<таблица>», «POST /rest/v1/rpc/<функция>»,
 *           «… /storage/v1/object», «POST /functions/v1/<функция>», статус, мс;
 *   nav   — первая загрузка: ttfb, dcl, lcp; с 21.10 (письмо
 *           ЛК_СРОЧНО_урок_перезагрузка_НЕ_исправлено.md) ещё диагностика —
 *           `type <navigate|reload|back_forward|prerender> <путь>` (как открыли
 *           страницу), `reload <причина> <путь>` (перед программной перезагрузкой),
 *           `error <сообщение>` (window.onerror / unhandledrejection). Отдельного
 *           kind нет: в базе ограничение route|api|nav, а выкатить нужно сегодня.
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

/** Расширение файла для телеметрии (`file-open:pdf`): буквы/цифры, иначе `other`. */
export function fileExtLabel(url: string): string {
  const name = url.split('?')[0].split('#')[0].split('/').pop() ?? ''
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'other'
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
  markAlive()
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

// ── диагностика перезагрузок и ошибок (21.10) ────────────────────────────────

const PENDING_KEY = 'rum:pending'
const MAX_ERRORS = 20
let errorsThisPage = 0
let activeTransport: RumTransport | null = null

function keepPending(events: PerfEvent[]): void {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    const prev = raw ? JSON.parse(raw) : []
    localStorage.setItem(PENDING_KEY, JSON.stringify([...(Array.isArray(prev) ? prev : []), ...events].slice(-50)))
  } catch { /* RUM молчит */ }
}

/**
 * Важное событие, которое обязано пережить смерть вкладки: сначала в
 * localStorage, потом сразу keepalive-запросом. Нет входа или запрос не ушёл —
 * событие лежит и уйдёт при ближайшей возможности (`sendPending`) или при
 * следующем старте страницы. Письма 21.10 (перезагрузки) и 27.10 (iPhone:
 * `play` шёл обычной пачкой раз в 30 с и умирал вместе со страницей).
 */
// Защита от штормов (письмо 28.10: 950 `play-ready` за 3 с): одинаковое важное
// событие — один раз за загрузку, всего — не больше MAX_URGENT.
const MAX_URGENT = 20
const urgentSeen = new Set<string>()

function noteUrgent(label: string, ms: number = 0): void {
  const l = label.slice(0, 120)
  if (urgentSeen.has(l) || urgentSeen.size >= MAX_URGENT) return
  urgentSeen.add(l)
  try {
    keepPending([{ k: 'nav', l, ms: Math.round(ms), d: device }])
    sendPending()
  } catch { /* RUM молчит */ }
}

/** Отправить отложенные важные события, если есть вход. */
function sendPending(): void {
  try {
    if (!activeTransport?.signedIn()) return
    const raw = localStorage.getItem(PENDING_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list) || list.length === 0) return
    localStorage.removeItem(PENDING_KEY)
    activeTransport.sendOnExit(list.slice(-50))
  } catch { /* RUM молчит */ }
}

/** Перед любой программной перезагрузкой: причина — важным событием. */
export function noteReload(reason: string): void {
  noteUrgent(`reload ${reason} ${typeof location !== 'undefined' ? routeLabel(location.pathname) : ''}`)
}

/**
 * Шаги запуска видео — важными событиями, чтобы было видно, на каком шаге
 * умирает вкладка: `play` (нажали ▶), `play-load` (iframe загрузился),
 * `play-ready` (плеер ответил `ready`).
 */
export function noteUrgentNav(kind: string, path: string = typeof location !== 'undefined' ? location.pathname : ''): void {
  noteUrgent(`${kind} ${routeLabel(path)}`)
}

/**
 * Событие навигации без длительности: `play` (создан плеер видео), `hide`
 * (вкладка ушла в фон), `restore` (после выгрузки вкладки восстановили раздел
 * и прокрутку), `crash` (прошлую загрузку убили — см. ALIVE_KEY). Письма 27.10
 * про телефон: так видно, после чего вкладку убивает браузер.
 */
export function noteNav(kind: string, path: string = typeof location !== 'undefined' ? location.pathname : ''): void {
  record('nav', `${kind} ${routeLabel(path)}`.slice(0, 120), 0)
}

/**
 * «Сессия жива»: при старте страницы пишем маршрут, на `pagehide` снимаем.
 * Осталась отметка с прошлого раза — страницу убили, не дав ей закрыться.
 * Эти две отметки храним в sessionStorage текущей вкладки: localStorage общий
 * для всех вкладок сайта и давал ложные crash при параллельной работе.
 *
 * С 15.11 два случая различаются (у 16 из 17 учеников с телефона 14.11 был
 * `crash`, и по одному слову нельзя было понять, где беда):
 *   `evicted <маршрут>` — вкладку убили, пока она была в фоне (ученик ушёл в
 *       калькулятор/Telegram/PDF в соседней вкладке, телефон забрал память).
 *       Рядом три числа в поле ms: `evicted-away-s` — сколько секунд вкладка
 *       пробыла в фоне до возврата (верхняя граница: когда именно убили,
 *       не видно); `evicted-dom` — элементов на странице в момент ухода;
 *       `evicted-media` — картинок + canvas + iframe в момент ухода.
 *       Вытеснили через 10 с с лёгкой страницы — повод смотреть на соседа
 *       (PDF во второй вкладке); через полчаса — обычная жизнь телефона.
 *   `crash <маршрут>` — убили, пока ученик смотрел на страницу: это уже
 *       наша тяжесть или падение браузера.
 */
const ALIVE_KEY = 'rum:alive'
const HIDDEN_KEY = 'rum:hidden'

interface HiddenMark { at: number; dom: number; media: number }

// Один раз на загрузку документа: повторный `startRum` (StrictMode в деве,
// перемонтирование трекера) видел бы свою же отметку и сообщал ложный `crash`.
let crashChecked = false

function checkCrash(): void {
  if (crashChecked) return
  crashChecked = true
  try {
    const prev = sessionStorage.getItem(ALIVE_KEY)
    const hidden = readHidden()
    sessionStorage.removeItem(HIDDEN_KEY)
    // Важным событием: вкладка, которую убили раз, часто убивают и второй —
    // раньше, чем уйдёт обычная пачка.
    if (prev && hidden) {
      noteUrgent(`evicted ${prev}`)
      noteUrgent(`evicted-away-s ${prev}`, Math.max(0, Math.round((Date.now() - hidden.at) / 1000)))
      noteUrgent(`evicted-dom ${prev}`, hidden.dom)
      noteUrgent(`evicted-media ${prev}`, hidden.media)
    } else if (prev) {
      noteUrgent(`crash ${prev}`)
    }
  } catch { /* RUM молчит */ }
  markOpen()
}

function readHidden(): HiddenMark | null {
  try {
    const raw = sessionStorage.getItem(HIDDEN_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<HiddenMark>
    if (typeof v?.at !== 'number' || !Number.isFinite(v.at)) return null
    return { at: v.at, dom: Number(v.dom) || 0, media: Number(v.media) || 0 }
  } catch { return null }
}

/** Ушли в фон: запомнить когда и насколько тяжёлой была страница. */
function markHidden(): void {
  try {
    if (!sessionStorage.getItem(ALIVE_KEY)) return
    const mark: HiddenMark = {
      at: Date.now(),
      dom: document.getElementsByTagName('*').length,
      media: document.images.length
        + document.getElementsByTagName('canvas').length
        + document.getElementsByTagName('iframe').length,
    }
    sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(mark))
  } catch { /* RUM молчит */ }
}

/** Вернулись на живую вкладку — она не умирала. */
function markVisible(): void {
  try { sessionStorage.removeItem(HIDDEN_KEY) } catch { /* RUM молчит */ }
}

function markOpen(): void {
  try { sessionStorage.setItem(ALIVE_KEY, routeLabel(location.pathname)) } catch { /* RUM молчит */ }
}

function markClosed(): void {
  try { sessionStorage.removeItem(ALIVE_KEY); sessionStorage.removeItem(HIDDEN_KEY) } catch { /* RUM молчит */ }
}

/** Маршрут сменился внутри приложения — отметка жизни на новом маршруте. */
function markAlive(): void {
  try { if (sessionStorage.getItem(ALIVE_KEY)) sessionStorage.setItem(ALIVE_KEY, routeLabel(location.pathname)) } catch { /* RUM молчит */ }
}

/** Ошибка страницы — коротко, без стека; не больше 20 на загрузку. */
export function noteError(message: unknown): void {
  if (errorsThisPage >= MAX_ERRORS) return
  errorsThisPage++
  const text = (message instanceof Error ? `${message.name}: ${message.message}` : String(message ?? 'unknown'))
    .replace(UUID_RE, ':id').replace(/\s+/g, ' ').trim()
  record('nav', `error ${text}`.slice(0, 120), 0)
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

/**
 * Уход в фон чаще, чем раз в эту паузу, пачку не шлёт (15.11, утро 14.11:
 * телефон ученика при каждом переключении на калькулятор/Telegram отправлял
 * `perf_ingest` — по 2–3 запроса за несколько секунд; под нагрузкой это был
 * самый дорогой по суммарному времени вызов школы). Закрытие страницы
 * (`pagehide`) шлёт всегда.
 */
export const MIN_HIDE_FLUSH_GAP_MS = 60_000

export function startRum(
  t: RumTransport,
  opts: { sampleRate?: number; intervalMs?: number; minHideFlushGapMs?: number } = {},
): () => void {
  if (started || typeof window === 'undefined') return () => {}
  started = true
  sampled = Math.random() < (opts.sampleRate ?? 1)
  let lastSentAt = 0
  const minHideGap = opts.minHideFlushGapMs ?? MIN_HIDE_FLUSH_GAP_MS
  activeTransport = t
  // Важные события прошлой страницы, которые не успели уйти (21.10, 27.10),
  // лежат в localStorage до первой отправки — `sendPending`, не в общей пачке:
  // вкладку, которую убили раз, часто убивают и второй.
  const onError = (e: ErrorEvent) => noteError(e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => noteError(e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const flush = () => {
    sendPending()
    if (!t.signedIn() || queue.length === 0) return
    const batch = takeBatch()
    lastSentAt = Date.now()
    t.send(batch).catch(() => { /* RUM молчит */ })
  }
  const flushOnExit = () => {
    sendPending()
    if (!t.signedIn() || queue.length === 0) return
    try {
      lastSentAt = Date.now()
      t.sendOnExit(takeBatch())
    } catch {
      /* RUM молчит */
    }
  }
  const onVisibility = () => {
    if (document.visibilityState !== 'hidden') { markVisible(); return }
    markHidden()
    noteNav('hide')
    // Частые уходы в фон копят события до обычной пачки, а не шлют каждый раз.
    if (Date.now() - lastSentAt >= minHideGap) flushOnExit()
  }
  const onPageHide = () => { markClosed(); flushOnExit() }
  // Вернулись из bfcache — страница та же и живая: отметку ставим заново.
  const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) markOpen() }
  checkCrash()

  const timer = setInterval(flush, opts.intervalMs ?? 30_000)
  // Сессия supabase-js поднимается асинхронно: важные события старта
  // (`crash`) уходят, как только появился вход, а не через 30 с.
  const pendingTimers = [1500, 5000].map(ms => setTimeout(sendPending, ms))
  recordNavigationTiming()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    clearInterval(timer)
    pendingTimers.forEach(clearTimeout)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    activeTransport = null
    started = false
  }
}

let navigationTimingRecorded = false

/** Метрики исходного документа. Восстановление из BFCache не создаёт новый замер. */
export function recordNavigationTiming(): void {
  if (navigationTimingRecorded) return
  navigationTimingRecorded = true
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const label = routeLabel(nav?.name ? new URL(nav.name, location.href).pathname : location.pathname)
    if (nav) {
      // Как открыли страницу: navigate / reload (F5 или программно) / back_forward.
      record('nav', `type ${nav.type || 'unknown'} ${label}`, nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : 0)
      if (nav.responseStart > 0) record('nav', `ttfb ${label}`, nav.responseStart)
      const dcl = () => {
        if (nav.domContentLoadedEventEnd > 0) record('nav', `dcl ${label}`, nav.domContentLoadedEventEnd)
      }
      if (nav.domContentLoadedEventEnd > 0) dcl()
      else window.addEventListener('DOMContentLoaded', () => setTimeout(dcl, 0), { once: true })
    }
    if (document.visibilityState === 'visible'
        && typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')) {
      let lcp = 0
      const collect = (entries: PerformanceEntry[]) => {
        for (const e of entries) lcp = Math.max(lcp, e.startTime)
      }
      const po = new PerformanceObserver((list) => collect(list.getEntries()))
      po.observe({ type: 'largest-contentful-paint', buffered: true })
      const done = () => {
        collect(po.takeRecords())
        po.disconnect()
        window.removeEventListener('pointerdown', done, true)
        window.removeEventListener('keydown', done, true)
        window.removeEventListener('pagehide', done)
        document.removeEventListener('visibilitychange', onVisibility)
        if (lcp > 0) record('nav', `lcp ${label}`, lcp)
      }
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') done()
      }
      // LCP окончательный после первого взаимодействия или ухода
      addEventListener('pointerdown', done, { once: true, capture: true })
      addEventListener('keydown', done, { once: true, capture: true })
      window.addEventListener('pagehide', done, { once: true })
      document.addEventListener('visibilitychange', onVisibility)
    }
  } catch {
    /* RUM молчит */
  }
}

/** Только для тестов: сбросить состояние модуля. */
export function __resetRumForTests(): void {
  queue.length = 0
  errorsThisPage = 0
  activeTransport = null
  inflight = 0
  routeStart = null
  sawRequest = false
  lastEnd = 0
  if (quietTimer) clearTimeout(quietTimer)
  quietTimer = null
  sampled = true
  started = false
  crashChecked = false
  navigationTimingRecorded = false
  urgentSeen.clear()
  try { sessionStorage.removeItem(ALIVE_KEY); sessionStorage.removeItem(HIDDEN_KEY) } catch { /* нет хранилища */ }
}
