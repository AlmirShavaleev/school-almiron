/**
 * Ретранслятор запросов к модели (письмо ЛК_СРОЧНО_ИИ_через_ретранслятор_Vercel.md, 20.10).
 *
 * OpenRouter отвечает 403 «Access denied by security policy» нашему серверу
 * в РФ (Beget, СПб), а из облака отвечает нормально. Поэтому ИИ-функции
 * (check-homework-ai, check-mock-exam-ai, rewrite-homework-comment,
 * student-feedback-ai) идут сюда: `AI_BASE_URL=https://www.almiron.ru/api/ai-relay`,
 * а функция Vercel пересылает запрос в OpenRouter как есть.
 *
 * Границы:
 *  · пускает только с заголовком `X-Relay-Secret`, равным env `AI_RELAY_SECRET`
 *    (сравнение за постоянное время); секрета на Vercel нет — 503, не открытый прокси;
 *  · только POST и только путь `chat/completions` — другого функции не зовут;
 *  · ключ OpenRouter здесь не хранится: он приходит от нашего сервера в Authorization;
 *  · ничего из тела и заголовков не логируется.
 * Чистая логика — здесь (её гоняет vitest), обработчик — `api/ai-relay/chat/completions.ts` (точный путь: catch-all в /api надёжен только у Next.js).
 */

export const RELAY_PREFIX = '/api/ai-relay/'
export const UPSTREAM = 'https://openrouter.ai/api/v1/'
export const ALLOWED_PATHS: readonly string[] = ['chat/completions']
const FORWARD_HEADERS = ['authorization', 'content-type', 'http-referer', 'x-title'] as const

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })

/** Равенство строк за постоянное время: сравниваем SHA-256, а не сами строки. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(ha), y = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** Путь после `/api/ai-relay/` — без query и лишних слэшей. */
export function relayPath(url: string): string {
  const { pathname } = new URL(url)
  const i = pathname.indexOf(RELAY_PREFIX)
  return i < 0 ? '' : pathname.slice(i + RELAY_PREFIX.length).replace(/^\/+|\/+$/g, '')
}

export async function handleRelay(
  request: Request,
  secret: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, 'Method Not Allowed')
  const expected = (secret ?? '').trim()
  if (!expected) return json(503, 'Relay is not configured')
  const got = request.headers.get('x-relay-secret') ?? ''
  if (!got || !(await safeEqual(got, expected))) return json(403, 'Forbidden')

  const path = relayPath(request.url)
  if (!ALLOWED_PATHS.includes(path)) return json(404, 'Not Found')
  if (!request.headers.get('authorization')) return json(401, 'Authorization required')

  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const v = request.headers.get(name)
    if (v) headers.set(name, v)
  }

  let upstream: Response
  try {
    upstream = await fetchImpl(UPSTREAM + path, { method: 'POST', headers, body: await request.arrayBuffer() })
  } catch {
    return json(502, 'Upstream unreachable')
  }
  // Ответ — как есть: статус и тело (потоком), тип содержимого.
  const out = new Headers()
  const type = upstream.headers.get('content-type')
  if (type) out.set('Content-Type', type)
  out.set('Cache-Control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
