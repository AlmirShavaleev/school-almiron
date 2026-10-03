import { useEffect, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { SHOW_ALL, parseVariantAnswerFlags, type VariantAnswerFlags } from '@/lib/variantAnswerFlags'

/**
 * §263. Флажки своей выдачи варианта (`my_variant_answer_flags`): показывает
 * ли учитель после сдачи правильные ответы и разбор, и не идёт ли сейчас
 * работа по времени. Только для сданного варианта. Нет функции (миграция не
 * применена) или сбой — «всё показывать»: так было до §263, и сервер всё
 * равно отдаёт ровно то, что положено.
 */
export function useVariantAnswerFlags(studentAssignmentId: string | null | undefined, submitted: boolean): VariantAnswerFlags {
  const [got, setGot] = useState<{ key: string; flags: VariantAnswerFlags } | null>(null)
  useEffect(() => {
    if (!studentAssignmentId || !submitted) return
    let cancelled = false
    void safeRpc('my_variant_answer_flags', { p_student_assignment_id: studentAssignmentId }).then(({ data, error }) => {
      if (cancelled) return
      setGot({ key: studentAssignmentId, flags: error ? SHOW_ALL : parseVariantAnswerFlags(data) })
    })
    return () => { cancelled = true }
  }, [studentAssignmentId, submitted])
  return got && got.key === studentAssignmentId && submitted ? got.flags : SHOW_ALL
}
