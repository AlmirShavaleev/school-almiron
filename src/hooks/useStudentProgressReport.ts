import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProgressReport } from '@/lib/parentReport'

/**
 * §217. Отчёт об успеваемости — ОДИН вызов на весь экран и весь лист.
 *
 * Считает база (`public.student_progress_report`, PENDING_217.sql). Клиент не
 * собирает отчёт из кусков намеренно: экран в кабинете и бумага, которую
 * родитель уносит домой, обязаны показывать одни и те же числа, а десяток
 * запросов расходится при первой же правке — и заметит это родитель.
 *
 * `supabase as any`: сгенерированные типы базы (src/types/database.ts) про эту
 * функцию ещё не знают — миграцию применяет оркестратор, он же перегенерирует
 * типы MCP. Руками их не дописываем (правило CLAUDE.md). Тот же приём стоит в
 * useStudentNumberStats и useStudentSubjectTargets (§216).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function useStudentProgressReport(
  studentId: string | null | undefined,
  from: string | null,
  to: string | null,
) {
  const [report, setReport] = useState<ProgressReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId || !from || !to) {
      setReport(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    db.rpc('student_progress_report', {
      p_student_id: studentId,
      p_from: from,
      p_to: to,
    })
      .then(({ data, error: rpcError }: { data: ProgressReport | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (rpcError) {
          setReport(null)
          setError(rpcError.message)
        } else {
          setReport(data ?? null)
          setError(null)
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setReport(null)
        setError(err instanceof Error ? err.message : 'Не удалось собрать отчёт')
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [studentId, from, to, tick])

  return { report, loading, error, reload }
}
