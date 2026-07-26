import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sortQueue, toQueueRows, type QueueRow } from '@/lib/homeworkQueue'
import type { TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'

/**
 * Общая очередь проверки ДЗ преподавателя: все сданные попытки по всем темам.
 *
 * Видимость держит RLS: сюда приходят только попытки курсов, где текущий
 * профиль — преподаватель/владелец (те же политики, что и у проверки внутри
 * темы). Хук ничего не фильтрует по ролям сам.
 */
export function useHomeworkReviewQueue() {
  const [rows, setRows] = useState<QueueRow[]>([])
  const [attemptFiles, setAttemptFiles] = useState<TopicHomeworkAttemptFileRow[]>([])
  const [studentNames, setStudentNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: err } = await supabase
        .from('topic_homework_attempts')
        .select(
          '*, homework:topic_homework!inner(id, title, topic:topics!inner(id, title, module:modules!inner(id, course:courses!inner(id, title))))',
        )
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }

      const queue = sortQueue(toQueueRows(data ?? []))
      setRows(queue)

      if (queue.length === 0) {
        setAttemptFiles([]); setStudentNames({}); setLoading(false)
        return
      }

      const attemptIds = queue.map(r => r.attempt.id)
      const studentIds = Array.from(new Set(queue.map(r => r.attempt.student_id)))

      const [filesRes, studentsRes] = await Promise.all([
        supabase.from('topic_homework_attempt_files').select('*').in('attempt_id', attemptIds).order('position'),
        supabase.from('students').select('id, profiles!inner(full_name)').in('id', studentIds),
      ])
      if (cancelled) return

      setAttemptFiles((filesRes.data ?? []) as TopicHomeworkAttemptFileRow[])
      const names: Record<string, string> = {}
      for (const s of (studentsRes.data ?? []) as any[]) {
        names[s.id] = s.profiles?.full_name ?? 'Ученик'
      }
      setStudentNames(names)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [tick])

  /**
   * Вердикт из очереди — тот же RPC, что и в теме. После успеха строка
   * убирается локально: попытка перестала быть `submitted`, ей тут не место.
   */
  const reviewAttempt = useCallback(
    async (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string) => {
      const { error: err } = await supabase.rpc('topic_homework_review_attempt', {
        p_attempt_id: attemptId,
        p_decision: decision,
        p_comment: comment?.trim() || undefined,
      })
      if (err) throw err
      setRows(prev => prev.filter(r => r.attempt.id !== attemptId))
    },
    [],
  )

  return { rows, attemptFiles, studentNames, loading, error, reload, reviewAttempt }
}
