import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { StudentJournal } from '@/types/journal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export type JournalPeriod = '30d' | '90d' | 'all' | 'custom'

export function periodToRange(period: JournalPeriod, customFrom?: string, customTo?: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (period === '30d') return { from: new Date(now.getTime() - 30 * 86400_000).toISOString(), to: now.toISOString() }
  if (period === '90d') return { from: new Date(now.getTime() - 90 * 86400_000).toISOString(), to: now.toISOString() }
  if (period === 'custom') return { from: customFrom ?? null, to: customTo ?? null }
  return { from: null, to: null } // 'all'
}

export function useStudentJournal(
  studentId: string | undefined,
  period: JournalPeriod,
  customFrom?: string,
  customTo?: string,
  subject?: string | null,
) {
  const profile = useAuthStore(s => s.profile)
  const [journal, setJournal] = useState<StudentJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !studentId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const { from, to } = periodToRange(period, customFrom, customTo)

    db.rpc('get_student_journal', {
      p_student_id: studentId,
      p_date_from:  from,
      p_date_to:    to,
      p_subject:    subject ?? null,
    }).then(({ data, error: err }: { data: StudentJournal | null; error: { message: string } | null }) => {
      if (cancelled) return
      if (err) setError(err.message)
      else     setJournal(data)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [profile, studentId, period, customFrom, customTo, subject, tick])

  return { journal, loading, error, reload }
}
