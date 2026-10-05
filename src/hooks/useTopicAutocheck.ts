import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  asFreshStudent,
  autocheckErrorMessage,
  parseAutocheckResults,
  parseAutocheckState,
  type AutocheckResults,
  type AutocheckState,
} from '@/lib/autocheck'

// RPC §266 нет в сгенерированных типах: их перегенерирует оркестратор после
// применения PENDING_266 (руками типы не дописываем — CLAUDE.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- см. выше
const db = supabase as any

export interface CheckResult {
  ok: boolean
  correct?: boolean
  error?: string
}

/**
 * §266. Задачи с автопроверкой урока: состояние (RPC `topic_autocheck_state`)
 * и проверка ответа (`topic_autocheck_check`). Эталон и решение приходят от
 * сервера только у закрытых задач; у персонала — всегда, поэтому в
 * предпросмотре (`preview`) состояние сбрасывается «как у нового ученика», а
 * проверка не зовётся вовсе.
 *
 * Ошибка чтения (нет миграции, нет прав) не роняет страницу: `state = null`,
 * блока просто нет.
 */
export function useTopicAutocheck(topicId: string | null | undefined, opts: { preview?: boolean; enabled?: boolean } = {}) {
  const { preview = false, enabled = true } = opts
  const [state, setState] = useState<AutocheckState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!topicId || !enabled) { setState(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    db.rpc('topic_autocheck_state', { p_topic_id: topicId }).then(
      ({ data, error: e }: { data: unknown; error: { message: string } | null }) => {
        if (cancelled) return
        if (e) { setError(e.message); setState(null) }
        else {
          const parsed = parseAutocheckState(data)
          setState(parsed && preview ? asFreshStudent(parsed) : parsed)
        }
        setLoading(false)
      },
      (e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи')
        setState(null)
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [topicId, enabled, preview, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  /** Отправить ответ. Новое состояние урока сервер возвращает тем же вызовом. */
  const check = useCallback(async (taskId: string, answer: string): Promise<CheckResult> => {
    if (preview) return { ok: false, error: 'В предпросмотре ответы не проверяются' }
    const { data, error: e } = await db.rpc('topic_autocheck_check', { p_task_id: taskId, p_answer: answer })
    if (e) {
      // Закрытую задачу (вторая вкладка, двойной клик) показываем как есть.
      if (String(e.message ?? '').includes('AUTOCHECK_CLOSED')) reload()
      return { ok: false, error: autocheckErrorMessage(e.message) }
    }
    const next = parseAutocheckState((data as Record<string, unknown> | null)?.state)
    if (next) setState(next)
    return { ok: true, correct: (data as Record<string, unknown> | null)?.correct === true }
  }, [preview, reload])

  return { state, loading, error, reload, check }
}

/** §266. Результаты класса по уроку — только персонал курса (иначе 42501). */
export function useTopicAutocheckResults(topicId: string | null | undefined, enabled = true) {
  const [results, setResults] = useState<AutocheckResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!topicId || !enabled) { setResults(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    db.rpc('topic_autocheck_results', { p_topic_id: topicId }).then(
      ({ data, error: e }: { data: unknown; error: { message: string } | null }) => {
        if (cancelled) return
        if (e) { setError(e.message); setResults(null) }
        else setResults(parseAutocheckResults(data))
        setLoading(false)
      },
      (e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Не удалось загрузить результаты')
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [topicId, enabled, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  return { results, loading, error, reload }
}

/** §266. Порядок и удаление задач (персонал курса). Ошибку отдаёт текстом. */
export async function reorderAutocheckTasks(topicId: string, ids: string[]): Promise<string | null> {
  const { error } = await db.rpc('topic_autocheck_reorder', { p_topic_id: topicId, p_task_ids: ids })
  return error ? String(error.message ?? 'Не удалось сохранить порядок') : null
}

export async function deleteAutocheckTask(taskId: string): Promise<string | null> {
  const { error } = await db.rpc('topic_autocheck_delete', { p_task_id: taskId })
  return error ? String(error.message ?? 'Не удалось удалить задачу') : null
}
