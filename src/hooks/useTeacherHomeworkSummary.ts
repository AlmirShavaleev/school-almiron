import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface TeacherHomeworkSummary {
  active_assignments: number
  scheduled_assignments: number
  attempts_awaiting_review: number
  returned_for_revision: number
  overdue_recipients: number
  accepted_today: number
  accepted_this_week: number
  groups_with_overdue_homework: number
  recently_assigned: { assignment_id: string; template_title: string; group_name: string; publish_at: string; due_at: string }[]
}

/** Homework V2 summary for the current teacher/curator/admin/owner — replaces reading
 * legacy homeworks/homework_submissions directly for dashboard cards. */
export function useTeacherHomeworkSummary() {
  const [summary, setSummary] = useState<TeacherHomeworkSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_teacher_homework_summary')
        if (cancelled) return
        if (err) { setError(err.message); setSummary(null); return }
        setSummary(data as unknown as TeacherHomeworkSummary)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { summary, loading, error }
}
