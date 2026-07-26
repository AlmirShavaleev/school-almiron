import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentHomeworkSummary {
  new: number
  to_do: number
  under_review: number
  returned_for_revision: number
  checked: number
  overdue: number
  nearest_due_at: string | null
  nearest_assignment_id: string | null
}

/** Homework V2 summary for the current student — replaces reading legacy
 * homeworks/homework_submissions directly on the student dashboard. */
export function useStudentHomeworkSummary() {
  const [summary, setSummary] = useState<StudentHomeworkSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_student_homework_summary')
        if (cancelled) return
        if (err) { setError(err.message); setSummary(null); return }
        setSummary(data as unknown as StudentHomeworkSummary)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { summary, loading, error }
}
