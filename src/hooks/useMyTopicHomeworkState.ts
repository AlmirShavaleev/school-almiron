import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMyStudentId } from '@/hooks/useMyTopicHomework'
import { usePreviewMode } from '@/store/staffModeStore'
import { attemptsNewestFirst, type TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * Состояние МОЕЙ работы по теме — словами, для группы «Домашнее задание».
 *
 * Кнопки у этой группы нет ни в одном состоянии: её засчитывает преподаватель,
 * приняв работу. Поэтому здесь нужен не переключатель, а честная подпись.
 *
 * Состояние берётся у ПОСЛЕДНЕЙ попытки (правило §88), через существующий
 * `attemptsNewestFirst` — своей копии сортировки не заводим. Выборка сужена по
 * своему `student_id`: у персонала RLS отдала бы работы всех учеников курса, и
 * подпись показывала бы чужое состояние.
 */
export type TopicHomeworkState = 'none' | 'not_submitted' | 'submitted' | 'returned' | 'accepted'

export const TOPIC_HOMEWORK_STATE_LABEL: Record<TopicHomeworkState, string> = {
  none: 'Домашнего задания нет',
  not_submitted: 'Не сдано',
  submitted: 'На проверке',
  returned: 'На доработке',
  accepted: 'Принято',
}

export function useMyTopicHomeworkState(topicId: string | null) {
  const preview = usePreviewMode()
  const { studentId, loading: resolvingStudent } = useMyStudentId(!preview)
  const [state, setState] = useState<TopicHomeworkState>('none')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (resolvingStudent && !preview) return
    if (!topicId || (!studentId && !preview)) { setState('none'); setLoading(false); return }

    let cancelled = false
    setLoading(true)

    async function load(sid: string | null) {
      const { data: homework } = await supabase
        .from('topic_homework')
        .select('id')
        .eq('topic_id', topicId!)
        .maybeSingle()

      if (cancelled) return
      if (!homework?.id) { setState('none'); setLoading(false); return }

      // Предпросмотр (§178): попытки не читаем — под RLS персонала пришли бы
      // чужие. ДЗ есть, своей работы нет: «Не сдано», как у нового ученика.
      if (sid === null) { setState('not_submitted'); setLoading(false); return }

      const { data: attempts } = await supabase
        .from('topic_homework_attempts')
        .select('*')
        .eq('homework_id', homework.id)
        .eq('student_id', sid)

      if (cancelled) return
      const latest = attemptsNewestFirst((attempts ?? []) as TopicHomeworkAttemptRow[])[0]

      setState(
        !latest || latest.status === 'draft' ? 'not_submitted'
          : latest.status === 'submitted' ? 'submitted'
            : latest.status === 'returned_for_revision' ? 'returned'
              : 'accepted',
      )
      setLoading(false)
    }

    void load(preview ? null : studentId)
    return () => { cancelled = true }
  }, [topicId, studentId, resolvingStudent, preview])

  return { state, loading: preview ? loading : loading || resolvingStudent }
}
