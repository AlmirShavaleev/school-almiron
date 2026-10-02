import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeHomeActivity, type HomeActivity } from '@/lib/studentHome'

/**
 * §254. Активность ученика для главной одним вызовом `student_home_activity()`.
 *
 * Функция definer и считает всё от auth.uid() — параметра «чей» у неё нет,
 * поэтому и здесь его нет. Ошибка (в том числе «функции нет», если фронт
 * приедет раньше миграции) страницу не роняет: `activity` остаётся null,
 * карточки серии и недель показывают спокойную строку с повтором.
 *
 * Тип вызова — свой, а не из `database.ts`: сгенерированные типы базы отстают
 * от прода и руками не дописываются (CLAUDE.md).
 */

type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

/** 12 недель календаря = до 84 дней от понедельника 11 недель назад. */
export const HOME_ACTIVITY_DAYS = 84

export function useStudentHomeActivity(profileId: string | null | undefined) {
  const [activity, setActivity] = useState<HomeActivity | null>(null)
  const [loading, setLoading] = useState(Boolean(profileId))
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!profileId) { setActivity(null); setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data, error: err } = await db.rpc<unknown>('student_home_activity', { p_days: HOME_ACTIVITY_DAYS })
        if (cancelled) return
        if (err) throw new Error(err.message ?? 'Не удалось загрузить активность')
        const parsed = normalizeHomeActivity(data)
        if (!parsed) throw new Error('Пустой ответ')
        setActivity(parsed)
      } catch (e) {
        if (cancelled) return
        setActivity(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить активность')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profileId, attempt])

  return { activity, loading, error, retry }
}
