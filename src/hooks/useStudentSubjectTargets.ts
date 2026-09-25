import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * §216. Цель по баллу — ОДНА НА ПРЕДМЕТ, а не одна на человека.
 *
 * `students.target_score` + `students.target_subject` дают ровно одну пару на
 * ученика, а предметов у него два (физика и профильная математика) с разными
 * целями. Решение владельца 25.09: цель заводится на предмет. Старое поле
 * живёт дальше и здесь не читается и не пишется — его судьба отдельным
 * решением.
 *
 * `supabase as any`: сгенерированные типы базы (src/types/database.ts) про
 * таблицу `student_subject_targets` ещё не знают — миграцию §216 применяет
 * оркестратор, он же перегенерирует типы MCP. Руками их не дописываем
 * (правило CLAUDE.md). Тот же приём уже стоит в useStudentNumberStats.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface StudentSubjectTarget {
  id: string
  student_id: string
  subject: string
  exam_type: string
  target_score: number
  updated_at: string | null
}

export function useStudentSubjectTargets(studentId: string | null | undefined) {
  const [targets, setTargets] = useState<StudentSubjectTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setTargets([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    db.from('student_subject_targets')
      .select('id, student_id, subject, exam_type, target_score, updated_at')
      .eq('student_id', studentId)
      .then(({ data, error: err }: { data: StudentSubjectTarget[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) { setError(err.message); setTargets([]) } else { setTargets(data ?? []) }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [studentId, tick])

  /**
   * Записать цель. `score === null` — «цель не задана»: строку удаляем, а не
   * пишем ноль. Ноль в отчёте читался бы как «цель — ноль баллов», а прочерк
   * честно говорит, что цели нет (решение владельца по макету).
   *
   * Пишем через upsert по тому же ключу, что стоит уникальностью в базе:
   * ученик + предмет + тип экзамена. `updated_by` обязателен — политика
   * записи требует, чтобы там стоял сам пишущий.
   */
  const save = useCallback(async (
    subject: string,
    examType: string,
    score: number | null,
    authorProfileId: string,
  ) => {
    if (!studentId) return
    if (score === null) {
      const { error: err } = await db.from('student_subject_targets')
        .delete()
        .eq('student_id', studentId)
        .eq('subject', subject)
        .eq('exam_type', examType)
      if (err) throw new Error(err.message)
    } else {
      const { error: err } = await db.from('student_subject_targets')
        .upsert({
          student_id: studentId,
          subject,
          exam_type: examType,
          target_score: score,
          updated_by: authorProfileId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'student_id,subject,exam_type' })
      if (err) throw new Error(err.message)
    }
    reload()
  }, [studentId, reload])

  return { targets, loading, error, reload, save }
}
