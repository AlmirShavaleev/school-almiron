import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { teacherHomeData, teacherHomePeriod, type TeacherGroupRow, type TeacherHomeData } from '@/lib/teacherHome'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

const GROUP_SELECT = `
  name, courses!inner(id),
  upcoming_exams:mock_exams!inner(id, title, starts_at)
`

export function useTeacherHome() {
  const scope = useMyTeachingScope(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const courseIds = scope.active ? scope.courseIds : null
  const scopeKey = courseIds?.join(',') ?? '*'
  const key = `${scopeKey}:${tick}`
  const [state, setState] = useState<{ key: string; home: TeacherHomeData | null; today: string; error: string | null } | null>(null)

  useEffect(() => {
    if (scope.loading) return
    let cancelled = false

    async function load() {
      const { today, now, nextWeek } = teacherHomePeriod(new Date())
      if (courseIds?.length === 0) {
        setState({ key, home: teacherHomeData([]), today, error: null })
        return
      }

      try {
        let query = supabase.from('groups').select(GROUP_SELECT)
          .eq('is_active', true)
          .not('courses.is_active', 'is', false)
          .not('courses.is_template', 'is', true)
          .gte('upcoming_exams.starts_at', now)
          .lt('upcoming_exams.starts_at', nextWeek)
          .order('name')
        if (courseIds) query = query.in('course_id', courseIds)
        // Сгенерированные типы mock_exams ещё не включают starts_at.
        const { data, error } = await query.overrideTypes<TeacherGroupRow[], { merge: false }>()
        if (error) throw error
        if (!cancelled) setState({ key, home: teacherHomeData(data ?? []), today, error: null })
      } catch {
        if (!cancelled) setState({ key, home: null, today, error: 'Не удалось загрузить ближайшие пробники.' })
      }
    }

    void load()
    return () => { cancelled = true }
    // Список courseIds представлен строковым ключом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope.loading])

  const current = !scope.loading && state?.key === key ? state : null
  return {
    home: current?.home ?? null,
    today: current?.today ?? '',
    loading: !current,
    error: current?.error ?? null,
    reload,
    courseIds,
    scopeLoading: scope.loading,
  }
}
