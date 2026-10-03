import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeOverview, type StudentOverview } from '@/lib/studentOverview'

/**
 * §261. Карточка ученика у учителя — ОДИН вызов `student_overview_for_staff` (PENDING_261): прогноз (свидетельства),
 * работы, серия, награды, уровень. Предмет клиент не передаёт: ответ по всем предметам, переключатель на экране
 * мгновенный, без второго запроса.
 *
 * Ошибка (нет прав, функции ещё нет до применения миграции) — `error`, карточка показывает «Не удалось загрузить»
 * с кнопкой повтора, а не выдуманные нули.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useStudentOverview(studentId: string | null | undefined) {
  const [data, setData] = useState<StudentOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setData(null); setLoading(false); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      const db = supabase as unknown as RpcLike
      if (typeof db.rpc !== 'function') { setLoading(false); return }
      try {
        const { data: raw, error: rpcError } = await db.rpc<unknown>('student_overview_for_staff', { p_student_id: studentId })
        if (cancelled) return
        if (rpcError) { setData(null); setError(rpcError.message || 'Не удалось загрузить') }
        else {
          const v = normalizeOverview(raw)
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
  }, [studentId, tick])

  return { data, loading, error, reload }
}
