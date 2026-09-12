import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { decodeBoard, type StudyPlanBoard } from '@/lib/studyPlanBoard'

/**
 * Учебный план курса у персонала (§151).
 *
 * Один запрос на экран: `study_plan_board` отдаёт ростер, раскладку, клетки с
 * уже посчитанным зачётом и сводку по неделям. Каждая запись — отдельная RPC
 * с проверкой `course_is_teacher_staff` внутри, после неё доска перечитывается
 * целиком: клетки зависят от дат, а даты — от плана.
 */
export interface StudyPlanActions {
  savePlan: (startDate: string, autoOpen: boolean) => Promise<void>
  spread: (perWeek: number) => Promise<number>
  setTopicWeek: (topicId: string, week: number | null) => Promise<void>
  setOverride: (studentId: string, topicId: string, next: { week: number } | { removed: true } | null) => Promise<void>
}

export function useStudyPlanBoard(courseId: string | undefined) {
  const [board, setBoard] = useState<StudyPlanBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!courseId) { setBoard(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase.rpc('study_plan_board', { p_course_id: courseId }).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      // null — нет прав на курс: доска пустая, страница скажет об этом словами.
      setBoard(data === null ? null : decodeBoard(data))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [courseId, tick])

  async function run<T>(fn: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    setBusy(true)
    try {
      const { data, error: err } = await fn()
      if (err) throw new Error(err.message)
      reload()
      return data
    } finally {
      setBusy(false)
    }
  }

  const actions: StudyPlanActions = {
    savePlan: async (startDate, autoOpen) => {
      if (!courseId) return
      await run(() => supabase.rpc('study_plan_save', { p_course_id: courseId, p_start_date: startDate, p_auto_open: autoOpen }))
    },
    spread: async (perWeek) => {
      if (!courseId) return 0
      return (await run(() => supabase.rpc('study_plan_spread', { p_course_id: courseId, p_per_week: perWeek }))) ?? 0
    },
    setTopicWeek: async (topicId, week) => {
      if (!courseId) return
      await run(() => supabase.rpc('study_plan_set_topic_week', { p_course_id: courseId, p_topic_id: topicId, p_week_no: week }))
    },
    setOverride: async (studentId, topicId, next) => {
      if (!courseId) return
      await run(() => supabase.rpc('study_plan_set_override', {
        p_course_id: courseId,
        p_student_id: studentId,
        p_topic_id: topicId,
        p_week_no: next && 'week' in next ? next.week : null,
        p_removed: !!(next && 'removed' in next),
      }))
    },
  }

  return { board, loading, busy, error, reload, actions }
}
