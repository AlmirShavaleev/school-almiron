import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Задачи к уроку глазами преподавателя (§164).
 *
 * Здесь только состав набора: что прикреплено, в каком порядке, сколько по
 * задаче ответов. Как их решают — в `useTopicTaskProgress` (§162).
 */

export interface StaffTaskRow {
  item_id:        string
  item_position:  number
  task_id:        string
  external_id:    string | null
  statement_html: string
  exam_part:      number | null
  max_points:     number | null
  auto_checkable: boolean
  answers_count:  number
  closed_count:   number
}

export interface AttachPreview {
  total:          number
  auto_checkable: number
  self_checked:   number
  part_two:       number
}

export function useTopicTasksStaff(topicId: string | undefined) {
  const [rows, setRows]       = useState<StaffTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!topicId) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error: err } = await db.rpc('topic_tasks_for_staff', { p_topic_id: topicId })
      if (err) throw new Error(err.message)
      setRows(data ?? [])
      setError(null)
    } catch (e) {
      // Сорвавшийся запрос не оставляет раздел в вечной загрузке.
      setError(e instanceof Error ? e.message : 'Не удалось загрузить задачи темы')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [topicId])

  useEffect(() => { void load() }, [load])

  /** Возвращает число ответов, если убирать нельзя без подтверждения. */
  const detach = useCallback(async (itemId: string, force = false): Promise<number | null> => {
    if (!topicId) return null
    setBusy(itemId)
    setError(null)
    try {
      const { error: err } = await db.rpc('topic_task_detach_item', {
        p_topic_id: topicId, p_item_id: itemId, p_force: force,
      })
      if (err) {
        const answers = /HAS_ANSWERS:(\d+)/.exec(err.message)
        if (answers) return Number(answers[1])
        throw new Error(humanizeAttachTaskError(err.message))
      }
      await load()
      return null
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось убрать задачу')
      return null
    } finally {
      setBusy(null)
    }
  }, [topicId, load])

  const move = useCallback(async (itemId: string, delta: number) => {
    if (!topicId) return
    setBusy(itemId)
    setError(null)
    try {
      const { error: err } = await db.rpc('topic_task_move_item', {
        p_topic_id: topicId, p_item_id: itemId, p_delta: delta,
      })
      if (err) throw new Error(humanizeAttachTaskError(err.message))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось поменять порядок')
    } finally {
      setBusy(null)
    }
  }, [topicId, load])

  return { rows, loading, error, busy, detach, move, reload: load }
}

/** Прикрепление отобранного в каталоге и предварительный состав отбора. */
export function useAttachTasksToTopic() {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = useCallback(async (taskIds: string[]): Promise<AttachPreview | null> => {
    if (taskIds.length === 0) return null
    try {
      const { data, error: err } = await db.rpc('catalog_tasks_attach_preview', { p_task_ids: taskIds })
      if (err) throw new Error(err.message)
      return data as AttachPreview
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать состав отбора')
      return null
    }
  }, [])

  const attach = useCallback(async (topicId: string, taskIds: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('attach_catalog_tasks_to_topic', {
        p_topic_id: topicId, p_task_ids: taskIds,
      })
      if (err) throw new Error(humanizeAttachTaskError(err.message))
      return data as { added: number; skipped: number; total: number }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прикрепить задачи')
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  return { preview, attach, busy, error }
}

/**
 * Кто мы для полосы контекста: тема, курс и путь назад.
 *
 * Спрашивают в двух местах — кнопка «Подобрать в каталоге» на теме и вход по
 * адресу `/catalog?attachTo=…`. Запрос один на оба: разъехаться нечему.
 */
export async function fetchAttachTarget(topicId: string): Promise<{
  topicId: string; topicTitle: string; courseTitle: string; returnTo: string
} | null> {
  const { data, error } = await db
    .from('topics')
    .select('id, title, modules(course_id, courses(title))')
    .eq('id', topicId)
    .maybeSingle()
  if (error || !data) return null

  const courseId = data.modules?.course_id ?? ''
  return {
    topicId:     data.id,
    topicTitle:  data.title ?? 'Тема',
    courseTitle: data.modules?.courses?.title ?? '',
    returnTo:    topicReturnPath(courseId, data.id),
  }
}

/** Путь назад к теме — на её раздел «Задачи» у преподавателя. */
export function topicReturnPath(courseId: string, topicId: string) {
  return `/course-program?courseId=${courseId}&materialsTopic=${topicId}&tile=test`
}

export function humanizeAttachTaskError(message: string): string {
  if (message.includes('ACCESS_DENIED')) return 'Нет прав на эту тему курса.'
  if (message.includes('NO_TASKS'))      return 'Ничего не отобрано.'
  if (message.includes('NO_ITEM'))       return 'Задача к этой теме не прикреплена.'
  if (message.includes('NO_TOPIC'))      return 'Тема не найдена.'
  return message
}
