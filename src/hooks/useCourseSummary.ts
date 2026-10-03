import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeCourseSummary, type CourseSummary } from '@/lib/courseSummary'

/**
 * §264. «Сводка» класса — ОДИН вызов `course_summary_for_staff` (PENDING_264) на курс. Прогноз, «вовремя» и
 * «просел» считает клиент (`lib/courseSummary.ts`) теми же правилами, что карточка ученика (§261).
 *
 * Ошибка (нет прав, функции ещё нет до применения миграции) — `error`, экран показывает «Не удалось загрузить» с
 * повтором, а не выдуманные нули.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useCourseSummary(courseId: string | null | undefined) {
  const [data, setData] = useState<CourseSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!courseId) { setData(null); setLoading(false); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      const db = supabase as unknown as RpcLike
      if (typeof db.rpc !== 'function') { setLoading(false); return }
      try {
        const { data: raw, error: rpcError } = await db.rpc<unknown>('course_summary_for_staff', { p_course_id: courseId })
        if (cancelled) return
        if (rpcError) { setData(null); setError(rpcError.message || 'Не удалось загрузить') }
        else {
          const v = normalizeCourseSummary(raw)
          setData(v)
          setError(v ? null : 'Пустой ответ')
        }
      } catch (e) {
        if (cancelled) return
        setData(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить')
      }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [courseId, tick])

  return { data, loading, error, reload }
}
