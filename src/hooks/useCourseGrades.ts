import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseGrades, type CourseGrades } from '@/lib/courseGrades'
import type { LoadStatus } from './useCourseAssessments'

/**
 * §249. Журнал оценок вкладки «Проверочные и контрольные».
 *
 * RPC `course_assessment_grades` (PENDING_249) нет в сгенерированных типах —
 * отсюда `as never`, как у §241/§242. Ошибка — не падение вкладки: до
 * применения миграции (или при сбое) список работ §241 остаётся, а на месте
 * журнала — объяснение. Поэтому здесь `status: 'error'`, а решает экран.
 */
export function useCourseGrades(courseId: string | null | undefined, refreshKey = 0, enabled = true) {
  const [state, setState] = useState<{ key: string; status: LoadStatus; data: CourseGrades | null }>({ key: '', status: 'idle', data: null })

  useEffect(() => {
    if (!courseId || !enabled) return
    let cancelled = false
    const key = `${courseId}:${refreshKey}`
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('course_assessment_grades' as never, { p_course_id: courseId } as never)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const parsed = parseGrades(data)
        setState({ key, status: parsed ? 'ready' : 'error', data: parsed })
      } catch (e) {
        if (cancelled) return
        console.warn('Не удалось загрузить журнал оценок «Проверочные и контрольные»', e)
        setState({ key, status: 'error', data: null })
      }
    })()
    return () => { cancelled = true }
  }, [courseId, refreshKey, enabled])

  if (!courseId || !enabled) return { status: 'idle' as LoadStatus, data: null }
  // Ответ помечен ключом запроса: другой курс — «грузится»; перечитка того же
  // курса держит прежние данные на экране, пока не придёт новый ответ.
  const mine = state.key.startsWith(`${courseId}:`) ? state : null
  return { status: mine?.status ?? 'loading', data: mine?.data ?? null }
}
