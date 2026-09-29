import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeOverview, type CourseStats } from '@/lib/coursesOverview'

/**
 * §244. Цифры страницы «Курсы» одним вызовом `teacher_courses_overview`.
 *
 * Передаём ровно те курсы, что уже на странице (`useCourseProgram` сузил их
 * до «своих» у владельца в режиме учителя): администратору `course_is_staff`
 * отвечает «да» на любой курс, и без списка функция посчитала бы всю школу.
 *
 * Ошибка (в том числе «функции нет» — фронт может приехать раньше миграции)
 * не роняет список: `stats` остаётся null, страница рисует курсы без цифр.
 */

type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useTeacherCoursesOverview(courseIds: string[], enabled = true) {
  const [stats, setStats] = useState<CourseStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = [...courseIds].sort().join(',')

  useEffect(() => {
    if (!enabled || !key) {
      setStats(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data, error: err } = await db.rpc<unknown>('teacher_courses_overview', { p_course_ids: key.split(',') })
        if (cancelled) return
        if (err) {
          setStats(null)
          setError(err.message ?? 'Не удалось загрузить цифры')
        } else {
          setStats(normalizeOverview(data))
        }
      } catch (e) {
        if (cancelled) return
        setStats(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить цифры')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [key, enabled])

  return { stats, loading, error }
}
