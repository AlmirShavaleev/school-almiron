import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeTopicJournal, type TopicJournal } from '@/lib/topicJournal'

/**
 * ДЗ тем и тесты тем для журнала одного ученика.
 *
 * Читает `get_student_topic_journal` — одна RPC на весь блок. Кто вправе
 * увидеть журнал (сам ученик, admin/owner, преподаватель его группы),
 * решает функция; здесь мы только различаем «нет доступа» (RPC вернула null)
 * и «данных нет».
 */
export function useStudentTopicJournal(studentId: string | null | undefined, courseId?: string | null) {
  const [journal, setJournal] = useState<TopicJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setJournal(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      const { data, error: err } = await supabase.rpc('get_student_topic_journal', {
        p_student_id: studentId,
        p_course_id: courseId ?? undefined,
      })
      if (cancelled) return
      if (err) {
        setError(err.message)
        setJournal(null)
      } else {
        setJournal(normalizeTopicJournal(data))
      }
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [studentId, courseId, tick])

  return { journal, loading, error, reload }
}
