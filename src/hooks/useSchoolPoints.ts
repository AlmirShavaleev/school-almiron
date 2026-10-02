import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeSchoolPoints, type SchoolPoints } from '@/lib/schoolPoints'

/**
 * §255. «Баллы школы» одним вызовом `student_school_points()` (definer, от
 * auth.uid()). Баллы производные — из истории, ничего не пишется;
 * `leaderboard_points` не используется (её select открыт всем, а рейтинга у
 * нас нет). Ошибка карточку не роняет — строка с повтором.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useSchoolPoints(profileId: string | null | undefined) {
  const [points, setPoints] = useState<SchoolPoints | null>(null)
  const [loading, setLoading] = useState(Boolean(profileId))
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!profileId) { setPoints(null); setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data, error: err } = await db.rpc<unknown>('student_school_points')
        if (cancelled) return
        if (err) throw new Error(err.message ?? 'Не удалось загрузить баллы')
        const parsed = normalizeSchoolPoints(data)
        if (!parsed) throw new Error('Пустой ответ')
        setPoints(parsed)
      } catch (e) {
        if (cancelled) return
        setPoints(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить баллы')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profileId, attempt])

  return { points, loading, error, retry }
}
