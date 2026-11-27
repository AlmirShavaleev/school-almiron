import { supabase } from '@/lib/supabase'

/**
 * §263. Вызов RPC, который не бросает: ни сетевой сбой, ни отсутствие функции
 * (миграция ещё не применена), ни подменённый клиент без `rpc` не роняют
 * экран — приходит `{ data: null, error }`. Для необязательных сведений
 * (режим работы, отметки, флажки варианта, уходы), где сбой = «как раньше».
 * Функций нет в сгенерированных типах — отсюда нетипизированный вызов.
 */
export async function safeRpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  try {
    const client = supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> }
    const { data, error } = await client.rpc(fn, args)
    return {
      data: error ? null : data,
      error: error ? { message: error.message ?? 'Ошибка', ...(error.code ? { code: error.code } : {}) } : null,
    }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'Ошибка' } }
  }
}
