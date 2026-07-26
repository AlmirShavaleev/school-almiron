import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentHomeworkJournalRow {
  assignment_id: string
  template_id: string
  template_version_id: string
  title: string
  course_id: string
  course_title: string
  group_id: string
  group_title: string
  effective_due_at: string | null
  viewed_at: string | null
  latest_attempt_id: string | null
  latest_attempt_number: number | null
  latest_attempt_status: string | null
  latest_score: number | null
  latest_review_decision: string | null
  latest_review_comment: string | null
  submitted_at: string | null
  is_overdue: boolean
  ui_category: string
}

/** Homework V2 assignments for a given student, scoped to groups the calling teacher (or
 * admin/owner) actually teaches — replaces legacy homeworks/homework_submissions reads in
 * the teacher-facing student journal. */
export function useStudentHomeworkJournal(studentId: string | null | undefined) {
  const [rows, setRows] = useState<StudentHomeworkJournalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!studentId) { setRows([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_student_homework_journal', { p_student_id: studentId })
        if (cancelled) return
        if (err) { setError(err.message); setRows([]); return }
        setRows((data || []) as unknown as StudentHomeworkJournalRow[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [studentId])

  return { rows, loading, error }
}
