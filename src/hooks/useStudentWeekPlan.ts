import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HwStatus } from '@/lib/studyPlanBoard'

/**
 * Текущая неделя ученика по учебному плану (§151).
 *
 * Одна RPC `student_week_plan()`: база сама находит курсы ученика, номер
 * недели по московской дате и состояние каждой темы тем же правилом, что
 * и таблица владельца. Чужих учеников и чужих курсов в выдаче нет по
 * построению — функция считает от `auth_student_id()`.
 */
export interface StudentWeekTopic {
  topic_id: string
  title: string
  open_now: boolean
  hw_published: boolean
  hw_status: HwStatus
  done: boolean
  marked: boolean
}

export interface StudentWeekCourse {
  course_id: string
  group_id: string
  course_title: string
  subject: string
  /** ≤ 0 — план ещё не начался; > weeks_total — закончился. */
  week_no: number
  weeks_total: number
  week_start: string
  week_end: string
  deadline: string
  topics: StudentWeekTopic[]
}

export function useStudentWeekPlan(enabled = true) {
  const [courses, setCourses] = useState<StudentWeekCourse[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) { setCourses([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    supabase.rpc('student_week_plan').then(({ data, error: err }) => {
      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setCourses(Array.isArray(data) ? data as unknown as StudentWeekCourse[] : [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [enabled])

  return { courses, loading, error }
}
