import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface CourseHomeworkSummary {
  templates_count: number
  active_assignments_count: number
  scheduled_assignments_count: number
  recipients_count: number
  submitted_count: number
  awaiting_review_count: number
  returned_count: number
  accepted_count: number
  overdue_count: number
}

export function useCourseHomeworkSummary(courseId: string | null | undefined, topicId?: string | null) {
  const [summary, setSummary] = useState<CourseHomeworkSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!courseId) { setSummary(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_course_homework_summary', {
          p_course_id: courseId,
          p_topic_id: topicId ?? undefined,
        })
        if (cancelled) return
        if (err) { setError(err.message); setSummary(null); return }
        setSummary(data as unknown as CourseHomeworkSummary)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId, topicId, tick])

  return { summary, loading, error, reload }
}
