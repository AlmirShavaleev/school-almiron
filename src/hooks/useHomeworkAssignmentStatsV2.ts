import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface HomeworkAssignmentStats {
  assigned: number
  excused: number
  viewed: number
  not_started: number
  submitted: number
  under_review: number
  returned_for_revision: number
  accepted: number
  rejected: number
  overdue: number
}

export function useHomeworkAssignmentStatsV2(assignmentId: string | null) {
  const [stats, setStats] = useState<HomeworkAssignmentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!assignmentId) { setStats(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_homework_assignment_stats', { p_assignment_id: assignmentId })
        if (cancelled) return
        if (err) { setError(err.message); setStats(null); return }
        setStats(data as unknown as HomeworkAssignmentStats)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [assignmentId])

  return { stats, loading, error }
}
