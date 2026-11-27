import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { DayPoint } from '@/lib/livePulse'

export type TeacherActivityDays = 7 | 30 | 365

export interface TeacherActivitySeries {
  startsOn: string
  endsOn: string
  visits: DayPoint[]
  submissions: DayPoint[]
}

interface TeacherActivity {
  asOf: string
  week: TeacherActivitySeries
  enrolled: number
  visitedWeek: number
}

type ActivityBucket = { day: string; visits: number; submissions: number }

interface ActivityResponse {
  as_of: string
  days: ActivityBucket[]
  enrolled: number
  visited_week: number
}

function normalizeSeries(buckets: ActivityBucket[], startsOn: string, endsOn: string): TeacherActivitySeries {
  return {
    startsOn, endsOn,
    visits: buckets.map(({ day, visits }) => ({ day, value: visits })),
    submissions: buckets.map(({ day, submissions }) => ({ day, value: submissions })),
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
        const week = data.days.slice(-7)
        const normalized = {
          asOf: data.as_of,
          week: normalizeSeries(week, week[0].day, week[6].day),
          enrolled: data.enrolled,
          visitedWeek: data.visited_week,
        }
        if (!cancelled) setState({ key, data: normalized, failed: false })
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

interface PeriodResponse {
  starts_on: string
  ends_on: string
  buckets: ActivityBucket[]
}

export function useTeacherActivityPeriod(courseIds: string[] | null, days: TeacherActivityDays, asOf?: string) {
  const profile = useAuthStore(state => state.profile)
  const scope = courseIds === null ? null : [...new Set(courseIds)].sort()
  const enabled = Boolean(profile?.id && ['teacher', 'admin', 'owner'].includes(profile.role) &&
    asOf && days !== 7 && scope?.length !== 0)
  const query = useQuery({
    queryKey: ['teacher_activity_period', profile?.id, profile?.role, scope, days, asOf],
    enabled,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc('teacher_activity_period' as never, { p_course_ids: scope, p_days: days, p_as_of: asOf } as never)
        .abortSignal(signal)
        .overrideTypes<PeriodResponse, { merge: false }>()
      if (error || !Array.isArray(data?.buckets) || !data.buckets.length || !data.starts_on || !data.ends_on) {
        throw new Error('Invalid activity period')
      }
      return normalizeSeries(data.buckets, data.starts_on, data.ends_on)
    },
    staleTime: Infinity,
    retry: false,
  })
  return {
    data: enabled && !query.isError ? query.data : null,
    loading: enabled && query.isPending,
    failed: enabled && query.isError,
    reload: () => { if (enabled) void query.refetch() },
  }
}
