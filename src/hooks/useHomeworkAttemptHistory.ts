import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface AttemptHistoryEntry {
  id: string
  attempt_number: number
  status: string
  answer_text: string | null
  submitted_at: string | null
  score: number | null
  files: { id: string; storage_path: string; file_name: string; mime_type: string | null }[]
  reviews: { id: string; decision: string; score: number | null; comment: string | null; created_at: string; reviewer_name: string | null }[]
}

/** Full attempt + review history for one assignment/student — used by the journal's
 * expandable row. Relies on existing RLS (hwatt_select/hwrev_select/hwaf_select): teacher of
 * the group, admin/owner, or the student themself. No new RPC needed. */
export function useHomeworkAttemptHistory(assignmentId: string | null, studentId: string | null) {
  const [attempts, setAttempts] = useState<AttemptHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!assignmentId || !studentId) { setAttempts([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data: attemptRows, error: attErr } = await supabase
          .from('homework_attempts')
          .select('id, attempt_number, status, answer_text, submitted_at, score')
          .eq('assignment_id', assignmentId)
          .eq('student_id', studentId)
          .order('attempt_number', { ascending: true })
        if (attErr) throw attErr
        const ids = (attemptRows || []).map(a => a.id)
        if (ids.length === 0) { if (!cancelled) setAttempts([]); return }

        const [{ data: fileRows, error: fileErr }, { data: reviewRows, error: revErr }] = await Promise.all([
          supabase.from('homework_attempt_files').select('id, attempt_id, storage_path, file_name, mime_type').in('attempt_id', ids),
          supabase.from('homework_reviews').select('id, attempt_id, decision, score, comment, created_at, reviewer_id, profiles!homework_reviews_reviewer_id_fkey(full_name)').in('attempt_id', ids).order('created_at', { ascending: true }),
        ])
        if (fileErr) throw fileErr
        if (revErr) throw revErr

        const filesByAttempt: Record<string, AttemptHistoryEntry['files']> = {}
        for (const f of fileRows || []) (filesByAttempt[f.attempt_id] ||= []).push({ id: f.id, storage_path: f.storage_path, file_name: f.file_name, mime_type: f.mime_type })

        const reviewsByAttempt: Record<string, AttemptHistoryEntry['reviews']> = {}
        for (const r of (reviewRows || []) as any[]) {
          (reviewsByAttempt[r.attempt_id] ||= []).push({
            id: r.id, decision: r.decision, score: r.score, comment: r.comment, created_at: r.created_at,
            reviewer_name: r.profiles?.full_name ?? null,
          })
        }

        if (cancelled) return
        setAttempts((attemptRows || []).map(a => ({
          id: a.id, attempt_number: a.attempt_number, status: a.status, answer_text: a.answer_text,
          submitted_at: a.submitted_at, score: a.score,
          files: filesByAttempt[a.id] || [], reviews: reviewsByAttempt[a.id] || [],
        })))
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Не удалось загрузить историю попыток'); setAttempts([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [assignmentId, studentId])

  return { attempts, loading, error }
}
