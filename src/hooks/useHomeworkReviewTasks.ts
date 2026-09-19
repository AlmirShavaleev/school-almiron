import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  nextPosition,
  nextTaskNo,
  reviewTasksFromAi,
  sortReviewTasks,
  type ReviewTaskPatch,
  type ReviewTaskRow,
} from '@/lib/homeworkReviewTasks'
import type { AiTaskRow } from '@/lib/aiHomeworkCheck'

/**
 * `supabase as any`: `topic_homework_review_tasks` появилась миграцией §199, а
 * `src/types/database.ts` генерируется MCP по проду и отстаёт (CLAUDE.md —
 * руками типы не дописывать). Тот же приём, что у `annotation_sets` в
 * `TopicHomeworkStudent`.
 */
const db = () => supabase as any

const TABLE = 'topic_homework_review_tasks'

export type ReviewTasksSaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Таблица проверки одной попытки: чтение, первое заполнение копией из ИИ и
 * правка со сохранением сразу по изменению (§199).
 *
 * Заполнение вызывается САМО при открытии работы — как и перенос рамок ИИ в
 * разбор (§185 в `HomeworkReviewQueuePage`). Причина та же: второе нажатие
 * ничего не решает. Отказаться от таблицы, которую модель уже составила,
 * никто не отказывается, а RPC идемпотентна — правки преподавателя повторный
 * вызов не затирает.
 *
 * Права целиком на RLS: персонал курса читает и пишет, ученик видит свои
 * строки только после вердикта. Клиент ничего не перепроверяет.
 */
export function useHomeworkReviewTasks(attemptId: string | null, options?: { seed?: boolean }) {
  const seedWanted = options?.seed !== false
  const [rows, setRows] = useState<ReviewTaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<ReviewTasksSaveState>('idle')
  /** Заполнение — один раз на попытку за время жизни экрана. */
  const seededRef = useRef<string | null>(null)

  const fetchRows = useCallback(async (id: string): Promise<ReviewTaskRow[]> => {
    const { data, error: err } = await db()
      .from(TABLE)
      .select('*')
      .eq('attempt_id', id)
      .order('position')
    if (err) throw new Error(err.message)
    return sortReviewTasks((data ?? []) as ReviewTaskRow[])
  }, [])

  useEffect(() => {
    if (!attemptId) {
      setRows([])
      setError(null)
      setSaveState('idle')
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        let found = await fetchRows(attemptId)
        // Пусто — просим базу собрать таблицу из последней завершённой
        // ИИ-проверки. Отказ в правах или отсутствие проверки — не ошибка
        // экрана: таблицу можно набрать руками, и молчать тут правильнее,
        // чем показывать красную строку над работой.
        if (found.length === 0 && seedWanted && seededRef.current !== attemptId) {
          seededRef.current = attemptId
          const { error: seedErr } = await db()
            .rpc('topic_homework_review_tasks_seed', { p_attempt_id: attemptId })
          if (!seedErr) found = await fetchRows(attemptId)
        }
        if (!cancelled) setRows(found)
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить таблицу проверки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [attemptId, fetchRows, seedWanted])

  /**
   * Каждая правка — отдельная запись, сразу и без склейки по таймеру: ровно
   * тот вывод, что сделан в `SubmissionReviewer` (там склейка однажды съела
   * комментарий, сохранённый нажатием перед уходом со страницы).
   */
  const patchRow = useCallback(async (id: string, patch: ReviewTaskPatch) => {
    const before = rows
    // Оптимистично: выпадающий список обязан переключаться под пальцем, а не
    // после ответа сети — иначе сводка и балл дёргаются с задержкой.
    setRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)))
    setSaveState('saving')
    const { error: err } = await db().from(TABLE).update(patch).eq('id', id)
    if (err) {
      setRows(before)
      setSaveState('error')
      setError(err.message)
      return false
    }
    setSaveState('saved')
    return true
  }, [rows])

  const addRow = useCallback(async () => {
    if (!attemptId) return false
    setSaveState('saving')
    const { data, error: err } = await db()
      .from(TABLE)
      .insert({
        attempt_id: attemptId,
        no: nextTaskNo(rows),
        verdict: 'unchecked',
        position: nextPosition(rows),
      })
      .select('*')
      .single()
    if (err || !data) {
      setSaveState('error')
      setError(err?.message ?? 'Не удалось добавить строку')
      return false
    }
    setRows(current => sortReviewTasks([...current, data as ReviewTaskRow]))
    setSaveState('saved')
    return true
  }, [attemptId, rows])

  /**
   * Забрать таблицу ИИ себе руками. Автозаполнение выше молчит при отказе —
   * причин хватает (проверки не было, права, сеть), и красная строка над
   * работой ни одной из них не объясняет. Кнопка в панели даёт второй заход и
   * показывает причину, если она есть.
   */
  const seedNow = useCallback(async () => {
    if (!attemptId) return false
    setSaveState('saving')
    const { error: err } = await db()
      .rpc('topic_homework_review_tasks_seed', { p_attempt_id: attemptId })
    if (err) {
      setSaveState('error')
      setError(err.message)
      return false
    }
    try {
      setRows(await fetchRows(attemptId))
      setSaveState('saved')
      return true
    } catch (e: any) {
      setSaveState('error')
      setError(e?.message ?? 'Не удалось прочитать таблицу проверки')
      return false
    }
  }, [attemptId, fetchRows])

  /**
   * §207. Заполнить таблицу заново из свежей проверки ИИ.
   *
   * Отдельно от `seedNow`, потому что смысл противоположный: `seedNow`
   * идемпотентна и намеренно НЕ трогает готовую таблицу (§199 — слепок модели
   * не должен затирать правки человека), а здесь преподаватель сам решил, что
   * его таблица устарела и нужна новая. Поэтому старые строки удаляются.
   *
   * Строки собираются на клиенте из слепка (`reviewTasksFromAi`), а не
   * повторным вызовом RPC: RPC после удаления взяла бы ПОСЛЕДНЮЮ завершённую
   * проверку, а преподаватель нажал кнопку под конкретной, ту, о которой ему
   * сказали. И если вставка не удалась — прежние строки возвращаются на место:
   * потерять таблицу молча хуже, чем не обновить её.
   */
  const refillFromAi = useCallback(async (tasks: readonly AiTaskRow[]) => {
    if (!attemptId || tasks.length === 0) return false
    const before = rows
    setSaveState('saving')
    const { error: delErr } = await db().from(TABLE).delete().eq('attempt_id', attemptId)
    if (delErr) {
      setSaveState('error')
      setError(delErr.message)
      return false
    }
    const { error: insErr } = await db()
      .from(TABLE)
      .insert(reviewTasksFromAi(tasks).map(row => ({ ...row, attempt_id: attemptId })))
    if (insErr) {
      // Вернуть как было: у строк те же id, их только что удалили.
      await db().from(TABLE).insert(before.map(row => ({
        id: row.id,
        attempt_id: row.attempt_id,
        no: row.no,
        verdict: row.verdict,
        student_answer: row.student_answer,
        expected_answer: row.expected_answer,
        note: row.note,
        position: row.position,
      })))
      setRows(before)
      setSaveState('error')
      setError(insErr.message)
      return false
    }
    try {
      setRows(await fetchRows(attemptId))
      setSaveState('saved')
      return true
    } catch (e: any) {
      setSaveState('error')
      setError(e?.message ?? 'Не удалось прочитать таблицу проверки')
      return false
    }
  }, [attemptId, fetchRows, rows])

  const removeRow = useCallback(async (id: string) => {
    const before = rows
    setRows(current => current.filter(row => row.id !== id))
    setSaveState('saving')
    const { error: err } = await db().from(TABLE).delete().eq('id', id)
    if (err) {
      setRows(before)
      setSaveState('error')
      setError(err.message)
      return false
    }
    setSaveState('saved')
    return true
  }, [rows])

  return {
    rows,
    loading,
    error,
    saveState,
    addRow,
    patchRow,
    removeRow,
    seedNow,
    refillFromAi,
    reload: () => (attemptId ? fetchRows(attemptId).then(setRows) : Promise.resolve()),
  }
}

/**
 * Таблицы проверки нескольких попыток — для ученического разбора и для окна
 * «работы ученика» у преподавателя. Только чтение: правит таблицу очередь
 * проверки, а здесь её показывают.
 *
 * Гейт «только после вердикта» держит политика, не этот хук: до вердикта база
 * просто не отдаёт строк (см. `PENDING_199.sql`).
 */
export function useReviewTasksOfAttempts(attemptIds: readonly string[]) {
  const [rows, setRows] = useState<ReviewTaskRow[]>([])
  const key = [...attemptIds].sort().join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setRows([])
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await db().from(TABLE).select('*').in('attempt_id', ids).order('position')
      if (cancelled) return
      setRows(sortReviewTasks((data ?? []) as ReviewTaskRow[]))
    })()
    return () => { cancelled = true }
  }, [key])

  return rows
}
