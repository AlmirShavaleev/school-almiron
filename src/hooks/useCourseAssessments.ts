import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  parseMyAssessments, parseSummary, type CourseAssessmentsSummary, type MyAssessments,
} from '@/lib/courseAssessments'

/**
 * §241. Данные раздела «Контрольные, самостоятельные и пробники».
 *
 * RPC `my_course_assessments` / `course_assessments_summary` (PENDING_241) нет в
 * сгенерированных типах — отсюда `as never`, как у `topic_homework_my_window`.
 *
 * Ошибка — не падение экрана: до применения миграции (или при сбое) страница
 * рисуется как раньше — у ученика прежний блок «Пробники», у учителя прежний
 * раздел пробников группы. Поэтому здесь `status: 'error'`, а решает экран.
 */

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Ученик: свои работы и результаты по курсу группы. `enabled = false` — в предпросмотре персонала. */
export function useMyCourseAssessments(groupId: string | null | undefined, enabled = true) {
  const [state, setState] = useState<{ key: string; status: LoadStatus; data: MyAssessments | null }>({ key: '', status: 'idle', data: null })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!groupId || !enabled) return
    let cancelled = false
    const key = `${groupId}:${tick}`
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('my_course_assessments' as never, { p_group_id: groupId } as never)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const parsed = parseMyAssessments(data)
        setState({ key, status: parsed ? 'ready' : 'error', data: parsed })
      } catch (e) {
        if (cancelled) return
        console.warn('Не удалось загрузить раздел «Контрольные, самостоятельные и пробники»', e)
        setState({ key, status: 'error', data: null })
      }
    })()
    return () => { cancelled = true }
  }, [groupId, enabled, tick])

  // Ответ помечен ключом запроса: чужая группа — «грузится»; перечитка той же
  // группы держит прежние данные на экране (без мигания), пока не придёт новый.
  if (!enabled || !groupId) return { status: 'idle' as LoadStatus, data: null, reload }
  const mine = state.key.startsWith(`${groupId}:`) ? state : null
  return { status: mine?.status ?? 'loading', data: mine?.data ?? null, reload }
}

/** Учитель: сводка по классу. `refreshKey` — перечитать (закрыли окно темы). */
export function useCourseAssessmentsSummary(courseId: string | null | undefined, refreshKey = 0) {
  const [state, setState] = useState<{ key: string; status: LoadStatus; data: CourseAssessmentsSummary | null }>({ key: '', status: 'idle', data: null })

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    const key = `${courseId}:${refreshKey}`
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('course_assessments_summary' as never, { p_course_id: courseId } as never)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const parsed = parseSummary(data)
        setState({ key, status: parsed ? 'ready' : 'error', data: parsed })
      } catch (e) {
        if (cancelled) return
        console.warn('Не удалось загрузить сводку «Контрольные, самостоятельные и пробники»', e)
        setState({ key, status: 'error', data: null })
      }
    })()
    return () => { cancelled = true }
  }, [courseId, refreshKey])

  if (!courseId) return { status: 'idle' as LoadStatus, data: null }
  const mine = state.key.startsWith(`${courseId}:`) ? state : null
  return { status: mine?.status ?? 'loading', data: mine?.data ?? null }
}
