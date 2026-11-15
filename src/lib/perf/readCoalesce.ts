/**
 * 15.11. Одинаковые чтения из базы — один запрос.
 *
 * Нагрузочный тест 15.11 (бесплатный Supabase выдерживает ~250–300 запросов
 * в минуту): первое открытие «Моего кабинета» отправляло ~55 запросов, и
 * многие — одинаковые: `group_students` с одним и тем же select по 2–3 раза
 * в одну миллисекунду, `get_student_topic_journal` и `my_subscriptions` по
 * 3 раза, `courses` 3 раза, программа курса 4 раза за 16 секунд. Каждый
 * экран и хук читают «своё», не зная о соседях.
 *
 * Здесь, в fetch клиента Supabase, это решается разом для всех экранов:
 *  • одновременные одинаковые чтения (тот же метод, адрес, тело и заголовки,
 *    включая токен) уходят одним запросом, ответ получает каждый — своей копией;
 *  • ученику (не персоналу: у персонала есть живые обновления по realtime)
 *    удачный ответ ещё READ_TTL_MS отдаётся из памяти;
 *  • любая запись (ответ на задачу, сдача ДЗ, загрузка, функция, правка
 *    таблицы) сразу очищает память — после действия экран читает свежее.
 *
 * Читается: GET/HEAD к /rest/v1/*, GET /auth/v1/user и POST к RPC из
 * READ_RPC — функции только для чтения (STABLE в базе School, проверено 15.11).
 * Фоновые отметки (`school_presence_touch`, `record_app_visit`, `perf_ingest`)
 * — не чтение, но и память не чистят: они ничего из читаемого не меняют.
 */

export const READ_TTL_MS = 5_000
const MAX_ENTRIES = 300

/** RPC только для чтения, которые экраны ученика зовут чаще всего. */
export const READ_RPC = new Set([
  'my_subscriptions', 'subscription_enabled', 'subscription_tariffs_public', 'my_work_mode',
  'get_student_topic_journal', 'student_home_courses', 'student_path_home', 'student_home_activity',
  'student_exam_forecast_evidence', 'student_visible_topics', 'student_tmi_visible_topics',
  'my_course_topic_locks', 'my_course_access', 'my_course_demo', 'my_course_assessments', 'my_mock_exams',
  'course_topic_tasks_progress_for_student', 'topic_solution_state', 'topic_student_variants',
  'topic_tasks_for_student', 'topic_autocheck_state', 'topic_template_link', 'courses_showcase',
  'my_live_timed_works', 'my_topic_rating', 'catalog_my_overview',
])

const BACKGROUND_RPC = new Set(['school_presence_touch', 'record_app_visit', 'perf_ingest'])

interface Entry {
  promise: Promise<Response>
  /** Когда ответ перестаёт отдаваться из памяти; Infinity — запрос ещё в пути. */
  expiresAt: number
}

const entries = new Map<string, Entry>()
let ttlEnabled: () => boolean = () => false

/** Включить кэш на READ_TTL_MS (по умолчанию выключен — только объединение одновременных). */
export function configureReadCache(opts: { ttlEnabled: () => boolean }): void {
  ttlEnabled = opts.ttlEnabled
}

export function clearReadCache(): void {
  entries.clear()
}

type Kind = 'read' | 'background' | 'write' | 'other'

function classify(method: string, pathname: string): Kind {
  const m = method.toUpperCase()
  if ((m === 'GET' || m === 'HEAD') && pathname.startsWith('/rest/v1/')) return 'read'
  if (m === 'GET' && pathname === '/auth/v1/user') return 'read'
  const rpc = pathname.match(/^\/rest\/v1\/rpc\/([\w-]+)$/)
  if (rpc && m === 'POST') {
    if (READ_RPC.has(rpc[1])) return 'read'
    if (BACKGROUND_RPC.has(rpc[1])) return 'background'
    return 'write'
  }
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'other'   // storage, realtime и т. п.
  if (pathname.startsWith('/auth/v1/token')) return 'other'            // обновление токена — не данные
  return 'write'                                                       // таблицы, storage, функции
}

function headerKey(h: HeadersInit | undefined): string {
  if (!h) return ''
  const pairs: Array<[string, string]> = []
  new Headers(h).forEach((v, k) => { pairs.push([k, v]) })
  return pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}:${v}`).join('\n')
}

function abortError(): Error {
  try { return new DOMException('The operation was aborted.', 'AbortError') } catch { const e = new Error('Aborted'); e.name = 'AbortError'; return e }
}

/** Отдать копию общего ответа; свой signal у каждого потребителя. */
function deliver(p: Promise<Response>, signal: AbortSignal | null | undefined): Promise<Response> {
  const copy = p.then(r => r.clone())
  if (!signal) return copy
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    copy.then(
      r => { signal.removeEventListener('abort', onAbort); resolve(r) },
      e => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export function coalesceReads(base: typeof fetch, now: () => number = Date.now): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    // Request-объект (тело уже упаковано) — как есть, без объединения.
    if (typeof input !== 'string' && !(input instanceof URL)) return base(input, init)
    const url = typeof input === 'string' ? input : input.href
    let pathname: string
    try { pathname = new URL(url, 'http://x').pathname } catch { return base(input, init) }
    const method = (init?.method ?? 'GET').toUpperCase()
    const kind = classify(method, pathname)

    if (kind === 'write') {
      // До записи и после неё — память пуста: следующее чтение пойдёт в базу.
      entries.clear()
      try { return await base(input, init) } finally { entries.clear() }
    }
    if (kind !== 'read') return base(input, init)
    if (init?.body != null && typeof init.body !== 'string') return base(input, init)

    const key = `${method} ${url}\n${typeof init?.body === 'string' ? init.body : ''}\n${headerKey(init?.headers)}`
    const t = now()
    const hit = entries.get(key)
    if (hit && hit.expiresAt > t) return deliver(hit.promise, init?.signal)
    if (hit) entries.delete(key)

    while (entries.size >= MAX_ENTRIES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }

    // Общий запрос — без signal потребителя: отмена одного не обрывает остальных.
    const { signal, ...shared } = init ?? {}
    const entry: Entry = { promise: base(input, shared), expiresAt: Number.POSITIVE_INFINITY }
    entries.set(key, entry)
    entry.promise.then(
      res => {
        if (entries.get(key) !== entry) return
        if (res.ok && ttlEnabled()) entry.expiresAt = now() + READ_TTL_MS
        else entries.delete(key)
      },
      () => { if (entries.get(key) === entry) entries.delete(key) },
    )
    return deliver(entry.promise, signal)
  }
}

/** Только для тестов. */
export function __readCacheSizeForTests(): number {
  return entries.size
}
