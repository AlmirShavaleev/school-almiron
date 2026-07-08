import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { EMPTY_LESSON_SUMMARY } from '@/types/lessons'
import type { LessonSummary } from '@/types/lessons'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function useLessonSummary(lessonId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [summary, setSummary] = useState<LessonSummary>(EMPTY_LESSON_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !lessonId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.rpc('get_lesson_summary', { p_lesson_id: lessonId }).maybeSingle()
      .then(({ data, error: err }: { data: LessonSummary | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else     setSummary(data ?? EMPTY_LESSON_SUMMARY)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, lessonId, tick])

  return { summary, loading, error, reload }
}

export interface SaveLessonSummaryParams {
  planned_topic?:    string | null
  actual_topic?:     string | null
  lesson_summary?:   string | null
  student_feedback?: string | null
  teacher_notes?:    string | null
  recommendations?:  string | null
  board_url?:        string | null
  meeting_url?:      string | null
}

export function useSaveLessonSummary() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const save = useCallback(async (lessonId: string, params: SaveLessonSummaryParams): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const { error: err } = await db.rpc('save_lesson_summary', {
      p_lesson_id:        lessonId,
      p_planned_topic:    params.planned_topic ?? null,
      p_actual_topic:     params.actual_topic ?? null,
      p_lesson_summary:   params.lesson_summary ?? null,
      p_student_feedback: params.student_feedback ?? null,
      p_teacher_notes:    params.teacher_notes ?? null,
      p_recommendations:  params.recommendations ?? null,
      p_board_url:        params.board_url ?? null,
      p_meeting_url:      params.meeting_url ?? null,
    })

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { save, loading, error }
}
