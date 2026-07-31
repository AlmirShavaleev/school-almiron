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

// RPC returns SQL NULL (not '[]') for jsonb_agg over an empty set — normalized here once,
// at the data boundary, so components can rely on arrays always being arrays.
function normalizeJournal(data: StudentJournal | null): StudentJournal | null {
  if (!data) return null
  return {
    ...data,
    student: { ...data.student, groups: data.student.groups ?? [] },
    lessons: data.lessons ?? [],
    assignments: data.assignments ?? [],
    trend: data.trend ?? [],
  }
}

export function useStudentJournal(
  studentId: string | undefined,
  period: JournalPeriod,
  customFrom?: string,
  customTo?: string,
  subject?: string | null,
) {
  const profile = useAuthStore(s => s.profile)
  // В зависимостях эффекта ниже стоит profileId, а не сам profile. Объект
  // профиля пересоздаётся при каждом обновлении токена (и в любом моке, где
  // селектор возвращает новый объект), а «новая ссылка каждый рендер» в
  // зависимостях — это бесконечный цикл: эффект -> setState -> рендер ->
  // новая ссылка -> эффект. Идентификатор — примитив, он от этого защищён.
  const profileId = profile?.id ?? null
  const [journal, setJournal] = useState<StudentJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId || !studentId) return
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
      else     setJournal(normalizeJournal(data))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [profileId, studentId, period, customFrom, customTo, subject, tick])

  return { journal, loading, error, reload }
}
