/**
 * 15.11. Одновременные чтения RPC — одним запросом `rpc_batch`.
 *
 * Пул PostgREST на бесплатном Supabase — около 11 соединений; «Мой кабинет»,
 * страница курса и урок при открытии зовут по 5–10 функций сразу, и каждая
 * занимает своё соединение (плюс накладные расходы запроса: JWT, роль,
 * настройки). Здесь вызовы функций из READ_RPC, ушедшие в одно окно
 * BATCH_WINDOW_MS от одного и того же входа, собираются в один POST
 * /rest/v1/rpc/rpc_batch (миграции 20261115131439 и 20261115131549).
 *
 * Права те же: rpc_batch — SECURITY INVOKER, каждая функция внутри
 * выполняется с правами ученика и сама проверяет auth.uid(). Ответ каждому
 * вызывающему — в формате PostgREST (тело и HTTP-статус), так что экраны
 * ничего не замечают.
 *
 * Если rpc_batch нет (404) или сеть оборвалась — вызовы уходят по одному, как
 * раньше. Пакет без функции в базе выключается на 10 минут.
 *
 * Функции внутри пакета выполняются друг за другом в одном операторе, и
 * statement_timeout (8 с) у них общий. Когда база тормозит (нагрузочный тест
 * 15.11, 18:03 МСК: исчерпан запас процессора Nano), пакет упирается в лимит
 * и PostgREST отвечает 500 с кодом 57014. Всем вызовам отдаём исходную ошибку без автоматического
 * повторения: параллельная отправка тех же вычислений усиливает перегрузку.
 * Остальные ошибки пакета целиком (504 пула и т. п.) по-прежнему отдаются
 * всем как есть: повтор в переполненный пул только добавил бы очереди.
 */
import { READ_RPC } from './readCoalesce'

export const BATCH_WINDOW_MS = 8
// 6, а не 10: функции пакета делят один лимит 8 с — длинный пакет на
// медленной базе первым упирается в него.
export const MAX_BATCH = 6
const DISABLE_MS = 10 * 60_000

interface Pending {
  fn: string
  args: Record<string, unknown>
  input: string
  init: RequestInit
  resolve: (r: Response) => void
  reject: (e: unknown) => void
}

interface Queue {
  origin: string
  headers: HeadersInit | undefined
  calls: Pending[]
  timer: ReturnType<typeof setTimeout> | null
}

const queues = new Map<string, Queue>()
let disabledUntil = 0

function eligible(url: string, init: RequestInit | undefined): { fn: string; args: Record<string, unknown>; origin: string } | null {
  if ((init?.method ?? 'GET').toUpperCase() !== 'POST') return null
  if (init?.signal) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  const m = u.pathname.match(/^\/rest\/v1\/rpc\/([\w-]+)$/)
  if (!m || !READ_RPC.has(m[1]) || u.search) return null
  const h = new Headers(init?.headers)
  // .single()/.maybeSingle(), count, head — особые форматы ответа: мимо пакета.
  if (h.has('prefer') || /vnd\.pgrst/.test(h.get('accept') ?? '')) return null
  let args: unknown = {}
  if (init?.body != null) {
    if (typeof init.body !== 'string') return null
    if (init.body !== '') {
      try { args = JSON.parse(init.body) } catch { return null }
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  return { fn: m[1], args: args as Record<string, unknown>, origin: u.origin }
}

function groupKey(origin: string, init: RequestInit | undefined): string {
  const h = new Headers(init?.headers)
  return `${origin}\n${h.get('authorization') ?? ''}\n${h.get('apikey') ?? ''}`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function batchRpc(base: typeof fetch, now: () => number = Date.now): typeof fetch {
  function sendSingly(calls: Pending[]): void {
    for (const c of calls) base(c.input, c.init).then(c.resolve, c.reject)
  }

  async function flush(key: string): Promise<void> {
    const q = queues.get(key)
    if (!q) return
    queues.delete(key)
    const calls = q.calls
    if (calls.length === 1 || now() < disabledUntil) { sendSingly(calls); return }

    const headers = new Headers(q.headers)
    headers.set('Content-Type', 'application/json')
    headers.delete('content-length')
    let res: Response
    try {
      res = await base(`${q.origin}/rest/v1/rpc/rpc_batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_calls: calls.map(c => ({ fn: c.fn, args: c.args })) }),
      })
    } catch {
      sendSingly(calls)                                   // сеть оборвалась — по одному, как раньше
      return
    }
    if (res.status === 404) {                             // rpc_batch нет в базе — выключаем пакет
      disabledUntil = now() + DISABLE_MS
      sendSingly(calls)
      return
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // Ошибка пакета целиком (504 пула и т. п.): каждому — тот же ответ, как пришёл бы ему.
      for (const c of calls) c.resolve(new Response(text, { status: res.status, headers: res.headers }))
      return
    }
    let items: Array<{ status?: number; body?: unknown }>
    try {
      items = await res.json()
      if (!Array.isArray(items) || items.length !== calls.length) throw new Error('rpc_batch: неверный ответ')
    } catch {
      sendSingly(calls)
      return
    }
    calls.forEach((c, i) => c.resolve(jsonResponse(Number(items[i]?.status) || 200, items[i]?.body)))
  }

  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== 'string' && !(input instanceof URL)) return base(input, init)
    const url = typeof input === 'string' ? input : input.href
    const e = eligible(url, init)
    if (!e) return base(input, init)
    const key = groupKey(e.origin, init)
    return new Promise<Response>((resolve, reject) => {
      let q = queues.get(key)
      if (!q) {
        q = { origin: e.origin, headers: init?.headers, calls: [], timer: null }
        queues.set(key, q)
        q.timer = setTimeout(() => { void flush(key) }, BATCH_WINDOW_MS)
      }
      q.calls.push({ fn: e.fn, args: e.args, input: url, init: init ?? {}, resolve, reject })
      if (q.calls.length >= MAX_BATCH) {
        if (q.timer) clearTimeout(q.timer)
        void flush(key)
      }
    })
  }
}

/** Только для тестов. */
export function __resetRpcBatchForTests(): void {
  for (const q of queues.values()) if (q.timer) clearTimeout(q.timer)
  queues.clear()
  disabledUntil = 0
}
