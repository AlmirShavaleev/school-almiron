import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeHomeCourses, type HomeCourseProgress } from '@/lib/studentHomeCourses'
import type { WorkPlanRead } from '@/lib/studentWorkPlan'

type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

/**
 * Прогресс по курсам для главной — один вызов `student_home_courses()` на все
 * курсы ученика. Функция считает от auth.uid(), поэтому «чей» не передаётся;
 * `profileId` только включает запрос.
 *
 * Тип вызова свой: сгенерированные типы базы отстают от прода (CLAUDE.md).
 * Ошибка не роняет главную — курсы остаются без полосок, со ссылкой «в курс».
 */
export function useStudentHomeCourses(profileId: string | null | undefined) {
  const [courses, setCourses] = useState<HomeCourseProgress[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planSummary, setPlanSummary] = useState<{ profileId: string; data: WorkPlanRead } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!profileId) { setCourses(null); setPlanSummary(null); return }
      setError(null)
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data, error: err } = await db.rpc<unknown>('student_home_courses')
        if (cancelled) return
        if (err) throw new Error(err.message ?? 'Не удалось загрузить прогресс')
        setCourses(normalizeHomeCourses(data))
        const workPlans = Array.isArray(data)
          ? data.find(row => typeof row?.work_plans?.today === 'string' && Array.isArray(row.work_plans.plans))?.work_plans as WorkPlanRead | undefined
          : undefined
        setPlanSummary(workPlans ? { profileId, data: workPlans } : null)
      } catch (e) {
        if (cancelled) return
        setCourses([])
        setPlanSummary(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить прогресс')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profileId])

  return { courses, error, workPlans: planSummary?.profileId === profileId ? planSummary?.data ?? null : null }
}
