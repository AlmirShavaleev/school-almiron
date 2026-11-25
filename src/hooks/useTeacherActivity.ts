import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { DayPoint } from '@/lib/livePulse'

interface TeacherActivity {
  asOf: string
  visits: DayPoint[]
  submissions: DayPoint[]
  completed: DayPoint[]
  online: number
  enrolled: number
  visitedWeek: number
  visitDaysPerVisitor: number
}

interface ActivityResponse {
  as_of: string
  days: { day: string; visits: number; submissions: number; completed: number }[]
  online: number
  enrolled: number
  visited_week: number
  visit_days_per_visitor: number
}

function normalizeActivity(raw: ActivityResponse): TeacherActivity {
  const series = (key: 'visits' | 'submissions' | 'completed') => raw.days.map(day => ({ day: day.day, value: day[key] }))
  return {
    asOf: raw.as_of,
    visits: series('visits'),
    submissions: series('submissions'),
    completed: series('completed'),
    online: raw.online,
    enrolled: raw.enrolled,
    visitedWeek: raw.visited_week,
    visitDaysPerVisitor: raw.visit_days_per_visitor,
  }
}

export function useTeacherActivity(courseIds: string[] | null) {
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const scope = courseIds ? [...courseIds].sort().join(',') : '*'
  const key = `${scope}:${tick}`
  const [state, setState] = useState<{ key: string; data: TeacherActivity | null; failed: boolean } | null>(null)

  useEffect(() => {
    if (!scope) return
    let cancelled = false
    async function load() {
      try {
        const { data, error } = await supabase.rpc('teacher_activity_pulse' as never, {
          p_course_ids: scope === '*' ? null : scope.split(','),
        } as never).overrideTypes<ActivityResponse, { merge: false }>()
        if (error || !Array.isArray(data?.days) || data.days.length !== 14) throw new Error('Invalid activity response')
        if (!cancelled) setState({ key, data: normalizeActivity(data), failed: false })
      } catch {
        if (!cancelled) setState({ key, data: null, failed: true })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [key, scope])

  const current = state?.key === key ? state : null
  return { data: current?.data ?? null, loading: !!scope && !current, failed: current?.failed ?? false, reload }
}
