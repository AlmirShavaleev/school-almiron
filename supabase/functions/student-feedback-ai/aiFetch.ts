/**
 * Запрос к модели (OpenAI-совместимый `chat/completions`) — общий для четырёх
 * ИИ-функций: check-homework-ai, check-mock-exam-ai, rewrite-homework-comment,
 * student-feedback-ai. Файл лежит в КАЖДОЙ из них одинаковой копией, а не в
 * `_shared`: деплой с `-Shared` копирует на сервер всю общую папку, и чужая
 * старая версия однажды уже уронила функцию в 503. Одинаковость копий
 * сторожит тест `src/lib/__tests__/aiFetch.test.ts`.
 *
 * Зачем (письмо ЛК_СРОЧНО_ИИ_через_ретранслятор_Vercel.md, 20.10):
 *  · OpenRouter отвечает 403 серверу в РФ — запросы идут через ретранслятор
 *    на Vercel (`AI_BASE_URL=https://www.almiron.ru/api/ai-relay`), а он
 *    пускает только с заголовком `X-Relay-Secret` (env `AI_RELAY_SECRET`).
 *    Секрета нет — заголовка нет, прямой OpenRouter работает как раньше;
 *  · у fetch к модели не было таймаута: запрос висел до лимита воркера (150 с),
 *    и задачу закрывал сторож. Теперь — обрыв через 120 с с понятной ошибкой.
 */

export const AI_TIMEOUT_MS = 120_000
export const AI_TIMEOUT_MESSAGE = 'Модель не ответила за 120 с'

type Env = (name: string) => string | undefined

/** Заголовки запроса к модели; `X-Relay-Secret` — только если секрет задан. */
export function aiHeaders(apiKey: string, env: Env, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...extra,
  }
  const relay = (env('AI_RELAY_SECRET') ?? '').trim()
  if (relay) headers['X-Relay-Secret'] = relay
  return headers
}

/** Обрыв по таймауту — словами для `last_error`, а не «The signal has been aborted». */
export function isAiTimeout(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : ''
  return name === 'TimeoutError' || name === 'AbortError'
}

/**
 * POST в `${baseUrl}/chat/completions` с заголовками `aiHeaders` и таймаутом.
 * Таймаут — ошибка с текстом AI_TIMEOUT_MESSAGE; остальное — как у fetch.
 */
export async function aiChatFetch(
  baseUrl: string,
  apiKey: string,
  body: unknown,
  env: Env,
  extra: Record<string, string> = {},
  timeoutMs: number = AI_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  try {
    return await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: aiHeaders(apiKey, env, extra),
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (isAiTimeout(e)) throw new Error(AI_TIMEOUT_MESSAGE)
    throw e
  }
}
