import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMyStudentId } from '@/hooks/useMyTopicHomework'
import { isSelfMarkable, type TopicGroupKey } from '@/lib/topicProgress'

/**
 * Самоотметки ученика по ГРУППАМ рубрик одной темы (§121: «Теория», «Урок»).
 *
 * Отметка ставится и снимается сразу, не дожидаясь сети: ждать ответа на каждое
 * нажатие — мучение. Но при отказе базы состояние возвращается назад И причина
 * отдаётся наверх: экран не должен показывать того, чего в базе нет (§94), а
 * молчаливый откат читается как «глюк».
 *
 * Группа `homework` сюда не попадает никогда: её засчитывает принятая работа
 * (`topicProgress.groupDone`). Попытку отметить её руками ловит и клиент, и
 * CHECK таблицы.
 */
export function useTopicSectionMarks(topicId: string | null) {
  const { studentId, loading: resolvingStudent } = useMyStudentId()
  const [marks, setMarks] = useState<Set<TopicGroupKey>>(new Set())
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
      .select('group_key')
      .eq('topic_id', topicId)
      .eq('student_id', studentId)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message); setLoading(false); return }
        setMarks(new Set((data ?? []).map(r => r.group_key as TopicGroupKey)))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [topicId, studentId, resolvingStudent])

  const toggle = useCallback(async (group: TopicGroupKey) => {
    if (!topicId || !studentId) throw new Error('Не удалось определить ученика')
    if (!isSelfMarkable(group)) throw new Error('Этот раздел засчитывает система, а не отметка')

    const had = marks.has(group)
    const snapshot = new Set(marks)
    const next = new Set(marks)
    if (had) next.delete(group)
    else next.add(group)
    setMarks(next)
    setError(null)

    const query = had
      ? supabase.from('topic_section_marks').delete()
          .eq('topic_id', topicId).eq('student_id', studentId).eq('group_key', group)
      : supabase.from('topic_section_marks').insert({
          topic_id: topicId, student_id: studentId, group_key: group,
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
