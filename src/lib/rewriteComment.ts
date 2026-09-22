/**
 * §213. Клиентская половина «Переписать по таблице».
 *
 * Отдельный модуль ради одного: форма вердикта (`ReviewActions`) не должна
 * знать ни про `supabase.functions`, ни про форму ответа edge-функции — ей
 * нужен текст и причина отказа по-человечески. Заодно модуль легко
 * подменяется в тестах экрана.
 *
 * Наружу уходит ТОЛЬКО `attempt_id`: таблицу и замечания функция читает сама
 * (иначе из браузера можно было бы наврать модели про чужую работу).
 */

import { supabase } from '@/lib/supabase'

export interface CommentRewriteUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface CommentRewrite {
  /** Предложенный текст. Вставляет его человек — молча не подставляем. */
  text: string
  /** Какая модель писала: пригодится в разговоре о бюджете. */
  model: string | null
  usage: CommentRewriteUsage | null
}

/**
 * Достаёт человеческий текст ошибки из ответа функции.
 *
 * `supabase-js` на любой не-2xx кладёт в `error` только «non-2xx status», а
 * причина («Эта работа вам недоступна», «Таблица проверки пуста») лежит телом
 * ответа. Тот же приём, что в `useHomeworkAiCheck`.
 */
async function messageOf(fnError: unknown): Promise<string> {
  const err = fnError as { message?: string; context?: { json?: () => Promise<unknown> } }
  const fallback = err?.message || 'Не удалось переписать комментарий'
  const res = err?.context
  if (res && typeof res.json === 'function') {
    try {
      const body = await res.json() as { error?: unknown } | null
      if (body?.error) return String(body.error)
    } catch {
      // тело не JSON — остаётся общая формулировка
    }
  }
  return fallback
}

export async function rewriteCommentByTable(attemptId: string): Promise<CommentRewrite> {
  const { data, error } = await supabase.functions.invoke('rewrite-homework-comment', {
    body: { attempt_id: attemptId },
  })
  if (error) throw new Error(await messageOf(error))
  const payload = data as { text?: unknown; model?: unknown; usage?: unknown; error?: unknown } | null
  if (payload?.error) throw new Error(String(payload.error))
  const text = String(payload?.text ?? '').trim()
  if (!text) throw new Error('Модель вернула пустой ответ')
  return {
    text,
    model: typeof payload?.model === 'string' ? payload.model : null,
    usage: (payload?.usage as CommentRewriteUsage | null) ?? null,
  }
}
