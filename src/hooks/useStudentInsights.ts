import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { QUEUE_STATUSES, collapseToWorks, sortQueue, toQueueRows, type QueueRow } from '@/lib/homeworkQueue'
import { buildStudentInsights, type StudentInsights } from '@/lib/studentInsights'
import type { TopicHomeworkReviewRow } from '@/lib/topicHomework'

/**
 * Цифры по одному ученику для карточки преподавателя.
 *
 * Права держит RLS: `topic_homework_attempts_select` пускает персонал курса
 * через `topic_homework_can_manage`, ученика — только к своим работам. Никакого
 * клиентского сужения здесь не нужно и быть не должно: карточка открывается по
 * конкретному ученику, а не выдаёт список.
 *
 * «Последний заход» сознательно НЕ показывается: `app_visits` выдана только
 * service_role (§78), у преподавателя прав на неё нет. Рисовать плитку, под
 * которой нет данных, — ровно то, что запрещает вводная; активность считается
 * по последней сдаче.
 */
export function useStudentInsights(studentId: string | null) {
  const [insights, setInsights] = useState<StudentInsights | null>(null)
  const [works, setWorks] = useState<QueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setInsights(null); setWorks([]); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load(id: string) {
      const { data, error: err } = await supabase
        .from('topic_homework_attempts')
        .select(
          '*, homework:topic_homework!inner(id, title, grade_scale, due_at, topic:topics!inner(id, title, module:modules!inner(id, course:courses!inner(id, title))))',
        )
        .eq('student_id', id)
        .in('status', QUEUE_STATUSES)
        .order('submitted_at', { ascending: true })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }

      // То же схлопывание, что в очереди проверки (§88): работа — это пара
      // «ДЗ + ученик», а не попытка. Второй копии правила нет.
      const collapsed = sortQueue(collapseToWorks(toQueueRows(data ?? [])))

      // Вердикты нужны и по прошлым попыткам: балл принятой работы стоит на
      // последней, а причина возврата — на предыдущей.
      const attemptIds = collapsed.flatMap(w => [w.attempt.id, ...w.history.map(h => h.id)])
      let reviews: TopicHomeworkReviewRow[] = []
      if (attemptIds.length > 0) {
        const { data: rev } = await supabase
          .from('topic_homework_reviews')
          .select('*')
          .in('attempt_id', attemptIds)
          .order('created_at')
        if (cancelled) return
        reviews = (rev ?? []) as TopicHomeworkReviewRow[]
      }

      setWorks(collapsed)
      setInsights(buildStudentInsights({ works: collapsed, reviews }))
      setLoading(false)
    }

    void load(studentId)
    return () => { cancelled = true }
  }, [studentId, tick])

  return { insights, works, loading, error, reload }
}
