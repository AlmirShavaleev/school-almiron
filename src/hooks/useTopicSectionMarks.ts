import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMyStudentId } from '@/hooks/useMyTopicHomework'
import { isSelfMarkable } from '@/lib/topicProgress'
import type { TopicSection } from '@/lib/topicMaterialItems'

/**
 * Самоотметки ученика по разделам ОДНОЙ темы.
 *
 * Отметка ставится и снимается сразу, не дожидаясь сети: ученик щёлкает по
 * разделам подряд, и ожидание ответа на каждый щелчок превратило бы это в
 * мучение. Но при отказе базы состояние возвращается назад И причина отдаётся
 * наверх — экран не должен показывать того, чего в базе нет (§94), а
 * молчаливый откат читается как «глюк».
 *
 * Раздел `homework` сюда не попадает никогда: его состояние вычисляется из
 * принятой работы (`topicProgress.sectionDone`). Попытку отметить его руками
 * ловит и клиент, и CHECK таблицы.
 */
export function useTopicSectionMarks(topicId: string | null) {
  const { studentId, loading: resolvingStudent } = useMyStudentId()
  const [marks, setMarks] = useState<Set<TopicSection>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (resolvingStudent) return
    if (!topicId || !studentId) { setMarks(new Set()); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('topic_section_marks')
      .select('section')
      .eq('topic_id', topicId)
      .eq('student_id', studentId)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message); setLoading(false); return }
        setMarks(new Set((data ?? []).map(r => r.section as TopicSection)))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [topicId, studentId, resolvingStudent])

  const toggle = useCallback(async (section: TopicSection) => {
    if (!topicId || !studentId) throw new Error('Не удалось определить ученика')
    if (!isSelfMarkable(section)) throw new Error('Этот раздел засчитывает система, а не отметка')

    const had = marks.has(section)
    const snapshot = new Set(marks)
    const next = new Set(marks)
    if (had) next.delete(section)
    else next.add(section)
    setMarks(next)
    setError(null)

    const query = had
      ? supabase.from('topic_section_marks').delete()
          .eq('topic_id', topicId).eq('student_id', studentId).eq('section', section)
      : supabase.from('topic_section_marks').insert({
          topic_id: topicId, student_id: studentId, section,
        })

    const { error: err } = await query
    if (err) {
      setMarks(snapshot)
      const message = had ? 'Не удалось снять отметку' : 'Не удалось сохранить отметку'
      setError(`${message}: ${err.message}`)
      throw err
    }
  }, [marks, topicId, studentId])

  return {
    marks,
    toggle,
    /**
     * Есть ли кому отмечать. У персонала строки `students` нет — кнопку
     * показывать нельзя: отметить за ученика невозможно ни здесь, ни в базе
     * (пишущие политики требуют `student_id = auth_student_id()`).
     */
    canMark: !!studentId,
    loading: loading || resolvingStudent,
    error,
  }
}
