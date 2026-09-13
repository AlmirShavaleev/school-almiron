import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Как решают задачи к уроку — для экрана преподавателя (§162).
 *
 * Счётчик «прошли» из §52 здесь не годится: он считает статус `submitted`,
 * а задачи к уроку никто не «сдаёт» — статус остаётся `in_progress` навсегда.
 * Поэтому свой счёт: кто начал, кто закрыл все, и сколько закрыто разбором.
 */
export interface TopicTaskProgress {
  tasks_total: number
  students_total: number
  students_started: number
  students_done: number
  closed_auto: number
  closed_self: number
}

export function useTopicTaskProgress(topicId: string | undefined) {
  const [progress, setProgress] = useState<TopicTaskProgress | null>(null)

  useEffect(() => {
    if (!topicId) { setProgress(null); return }
    let cancelled = false

    // Через try/catch: сорвавшийся счётчик не должен ронять карточку темы —
    // она и без него показывает прежнюю подпись.
    void (async () => {
      try {
        const { data, error } = await db.rpc('topic_task_progress_for_staff', { p_topic_id: topicId })
        if (cancelled || error) return
        const row = (data ?? [])[0] ?? null
        // Нет задач — нет и строки: пусть карточка покажет прежнюю подпись.
        setProgress(row && row.tasks_total > 0 ? row : null)
      } catch {
        if (!cancelled) setProgress(null)
      }
    })()

    return () => { cancelled = true }
  }, [topicId])

  return progress
}
