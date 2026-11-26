import { supabase } from '@/lib/supabase'

/**
 * §263. Вызов RPC, который не бросает: ни сетевой сбой, ни отсутствие функции
 * (миграция ещё не применена), ни подменённый клиент без `rpc` не роняют
 * экран — приходит `{ data: null, error }`. Для необязательных сведений
 * (режим работы, отметки, флажки варианта, уходы), где сбой = «как раньше».
 * Функций нет в сгенерированных типах — отсюда нетипизированный вызов.
 */
export async function safeRpc(fn: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<{ data: unknown; error: { message: string } | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const client = supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> }
    const call = client.rpc(fn, args)
    type Result = Awaited<typeof call>
    let pending: PromiseLike<Result> = call
    if (timeoutMs && timeoutMs > 0) {
      const controller = new AbortController()
      const builder = call as typeof call & { abortSignal?: (signal: AbortSignal) => PromiseLike<Result> }
      if (typeof builder.abortSignal === 'function') pending = builder.abortSignal(controller.signal)
      const timeout = new Promise<Result>(resolve => {
        timer = setTimeout(() => {
          controller.abort()
          resolve({ data: null, error: { message: 'Превышено время ожидания' } })
        }, timeoutMs)
      })
      pending = Promise.race([pending, timeout])
    }
    const { data, error } = await pending
    return { data: error ? null : data, error: error ? { message: error.message ?? 'Ошибка' } : null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Ошибка' } }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
