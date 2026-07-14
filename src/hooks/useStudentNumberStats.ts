import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StudentNumberStatRow } from '@/utils/studentNumberStats'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const SUBJECT_TO_CATALOG: Record<string, string> = {
  math: 'Математика',
  physics: 'Физика',
}

const EXAM_TO_CATALOG: Record<string, string> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
}

export function useStudentNumberStats(
  studentId: string | null,
  subject: string | null | undefined,
  examType: string | null | undefined,
) {
  const [rows, setRows] = useState<StudentNumberStatRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!studentId || !subject || !examType) {
      setRows([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const rpcSubject = SUBJECT_TO_CATALOG[subject] ?? subject
    const rpcExamType = EXAM_TO_CATALOG[examType] ?? examType

    db.rpc('get_student_number_stats', {
      p_student_id: studentId,
      p_subject: rpcSubject,
      p_exam_type: rpcExamType,
    }).then(({ data, error: rpcError }: { data: StudentNumberStatRow[] | null; error: { message: string } | null }) => {
      if (cancelled) return
      if (rpcError) {
        setRows([])
        setError(rpcError.message)
      } else {
        setRows(data ?? [])
        setError(null)
      }
      setLoading(false)
    }).catch((err: unknown) => {
      if (cancelled) return
      setRows([])
      setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [studentId, subject, examType])

  return { rows, loading, error }
}
