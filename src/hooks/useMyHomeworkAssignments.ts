import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HomeworkV2Row } from '@/types/homeworkV2'

/** Student: own assignments. Staff: pass groupId/studentId to scope. */
export function useMyHomeworkAssignments(opts?: { groupId?: string | null; studentId?: string | null }) {
  const [rows, setRows] = useState<HomeworkV2Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_my_homework_assignments', {
          p_group_id: opts?.groupId ?? undefined,
          p_student_id: opts?.studentId ?? undefined,
        })
        if (cancelled) return
        if (err) { setError(err.message); setRows([]); return }
        setRows((data || []) as unknown as HomeworkV2Row[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [opts?.groupId, opts?.studentId, tick])

  return { rows, loading, error, reload }
}
