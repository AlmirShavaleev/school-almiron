/**
 * 15.11. RPC, которой нет в базе, не зовём снова и снова.
 *
 * Утро 14.11: `my_score_forecast` и `my_weekly_goals` (функций в базе School
 * нет — миграции не применены) уходили с каждой загрузкой кабинета, иногда
 * по два раза, и под нагрузкой каждая ждала в общей очереди PostgREST до
 * 18 секунд, чтобы получить 404. Экраны и так переживают отсутствие функции
 * («как раньше»), так что запоминаем ответ PGRST202 на MISSING_RPC_TTL_MS и
 * отвечаем тем же 404 сразу, без сети.
 *
 * Ключ — имя функции и набор имён аргументов: PGRST202 бывает и при
 * неверных аргументах, другой набор аргументов той же функции не блокируем.
 * Срок ограничен: функцию могут добавить миграцией, и через 10 минут (или
 * после перезагрузки страницы) запрос снова пойдёт в базу.
 */
export const MISSING_RPC_TTL_MS = 10 * 60_000

const RPC_RE = /\/rest\/v1\/rpc\/([\w-]+)/
const missing = new Map<string, number>()

function argKey(body: unknown): string {
  if (typeof body !== 'string' || body === '') return ''
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort().join(',') : ''
  } catch {
    return ''
  }
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

export function skipMissingRpc(base: typeof fetch, now: () => number = Date.now): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const m = urlOf(input).match(RPC_RE)
    if (!m) return base(input, init)
    const key = `${m[1]}(${argKey(init?.body)})`
    const until = missing.get(key)
    if (until !== undefined) {
      if (until > now()) {
        return new Response(
          JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${m[1]} (cached on client)` }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        )
      }
      missing.delete(key)
    }
    const res = await base(input, init)
    if (res.status === 404) {
      try {
        const body = await res.clone().json()
        if (body && body.code === 'PGRST202') missing.set(key, now() + MISSING_RPC_TTL_MS)
      } catch { /* не JSON — не наш случай */ }
    }
    return res
  }
}

/** Только для тестов. */
export function __resetMissingRpcForTests(): void {
  missing.clear()
}
