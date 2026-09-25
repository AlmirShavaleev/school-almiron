import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * §217. «Что делать до следующей встречи» — три строки преподавателя,
 * сохранённые ВМЕСТЕ С ОТЧЁТОМ, то есть на паре «ученик + период».
 *
 * Тот же отчёт, открытый через месяц, обязан показать то, о чём
 * договаривались тогда, а не то, что написано сейчас. Поэтому ключ — ученик и
 * обе границы периода, а не просто ученик.
 *
 * Читаются строки в составе самого отчёта (`next_steps`), здесь только
 * запись: второй источник тех же строк на экране разъехался бы с бумагой.
 *
 * Кнопки «собрать черновик ИИ» здесь НЕТ намеренно (решение оркестратора):
 * она живёт в соседнем блоке заметок, и тащить её сюда — отдельный разговор.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function useReportNextSteps(studentId: string | null | undefined) {
  const [saving, setSaving] = useState(false)

  const save = useCallback(async (
    from: string,
    to: string,
    steps: string[],
    authorProfileId: string,
  ) => {
    if (!studentId) return
    const clean = steps.map(s => (s ?? '').trim()).filter(Boolean).slice(0, 3)
    setSaving(true)
    try {
      const { error } = await db.from('student_report_next_steps').upsert({
        student_id: studentId,
        period_from: from,
        period_to: to,
        steps: clean,
        updated_by: authorProfileId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'student_id,period_from,period_to' })
      if (error) throw new Error(error.message)
    } finally {
      setSaving(false)
    }
  }, [studentId])

  return { save, saving }
}
