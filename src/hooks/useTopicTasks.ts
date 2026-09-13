import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { CatalogTaskAsset } from '@/hooks/useCatalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Задачи к уроку (§162).
 *
 * Тренировка, а не контрольная: вердикт приходит на каждую задачу сразу,
 * попыток сколько угодно, ничего не надо «начинать» и «завершать».
 *
 * Проверка ответа целиком на сервере — `answer_topic_task` спрашивает те же
 * `normalize_variant_answer` (§63) и `variant_answer_verdict` (§66), что и
 * весь остальной проект. Здесь её нет и быть не должно: вторая копия правила
 * уже стоила нам разбора «;» и «да/нет».
 */

export interface TopicTaskRow {
  student_assignment_id: string
  item_id: string
  item_position: number
  task_id: string
  statement_html: string
  assets: CatalogTaskAsset[]
  max_points: number | null
  /** Есть короткий ответ — значит, вердикт. Иначе задача закрывается разбором. */
  auto_checkable: boolean
  answer_raw: string | null
  is_correct: boolean | null
  attempts_count: number
  /** null — задача ещё открыта; 'auto' — решена; 'self' — разобрана. */
  closed_by: 'auto' | 'self' | null
  solution_shown_at: string | null
  /** Приходит только после явного «Посмотреть решение». */
  solution_html: string | null
  answer_html: string | null
}

export interface RevealedSolution {
  solution_html: string | null
  solution_plan_html: string | null
  answer_html: string | null
}

export function useTopicTasks(topicId: string | undefined) {
  const [rows, setRows]       = useState<TopicTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busyItem, setBusy]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!topicId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('topic_tasks_for_student', { p_topic_id: topicId })
      if (err) throw new Error(err.message)
      setRows((data ?? []).map(normalizeRow))
    } catch (e) {
      // Сорвавшийся запрос не должен оставлять вкладку в вечной загрузке:
      // ученик увидит ошибку и сможет обновить страницу.
      setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [topicId])

  useEffect(() => { void load() }, [load])

  /** Ответ с мгновенным вердиктом. Возвращает, верно ли, — для подсветки. */
  const answer = useCallback(async (itemId: string, raw: string): Promise<boolean | null> => {
    if (!topicId) return null
    setBusy(itemId)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('answer_topic_task', {
        p_topic_id: topicId, p_item_id: itemId, p_answer_raw: raw,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load()
      return Boolean(data?.is_correct)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить ответ')
      return null
    } finally {
      setBusy(null)
    }
  }, [topicId, load])

  const reveal = useCallback(async (itemId: string): Promise<RevealedSolution | null> => {
    if (!topicId) return null
    setBusy(itemId)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('reveal_topic_task_solution', {
        p_topic_id: topicId, p_item_id: itemId,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load()
      return data as RevealedSolution
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть разбор')
      return null
    } finally {
      setBusy(null)
    }
  }, [topicId, load])

  const closeSelf = useCallback(async (itemId: string) => {
    if (!topicId) return
    setBusy(itemId)
    setError(null)
    try {
      const { error: err } = await db.rpc('close_topic_task_self', {
        p_topic_id: topicId, p_item_id: itemId,
      })
      if (err) throw new Error(humanizeTaskError(err.message))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отметить задачу')
    } finally {
      setBusy(null)
    }
  }, [topicId, load])

  const total  = rows.length
  const solved = useMemo(() => rows.filter(r => r.closed_by !== null).length, [rows])

  return { rows, total, solved, loading, error, busyItem, answer, reveal, closeSelf, reload: load }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRow(row: any): TopicTaskRow {
  return {
    ...row,
    assets: Array.isArray(row.assets) ? row.assets : [],
    attempts_count: row.attempts_count ?? 0,
  }
}

export function humanizeTaskError(message: string): string {
  if (message.includes('ALREADY_SOLVED'))      return 'Задача уже решена.'
  if (message.includes('NOT_AUTO_CHECKABLE'))  return 'У этой задачи нет короткого ответа — откройте решение и отметьте сами.'
  if (message.includes('AUTO_CHECKABLE'))      return 'Эту задачу закрывает верный ответ, а не отметка.'
  if (message.includes('NOT_SOLVED_YET'))      return 'Разбор откроется после верного ответа.'
  if (message.includes('SOLUTION_NOT_SHOWN'))  return 'Сначала откройте решение.'
  if (message.includes('ACCESS_DENIED'))       return 'Задача недоступна.'
  return message
}
