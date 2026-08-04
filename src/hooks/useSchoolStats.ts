import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Живые числа школы для дашборда админа.
 *
 * Всё считает одна definer-RPC `admin_school_stats` и отдаёт ЧИСЛА, а не
 * таблицы: раздавать клиенту права на students/courses/topic_homework_* ради
 * `count` не нужно. Проверка роли — в теле функции, отказ приходит явной
 * ошибкой `ONLY_ADMIN_SEES_SCHOOL_STATS`, а не пустым результатом (урок §47:
 * проглоченный 42501 выглядит как «нет данных»).
 */
export interface SchoolStats {
  teachers:                 number
  students:                 number
  courses:                  number
  homework_submitted_total: number
  homework_submitted_7d:    number
  homework_reviewed:        number
  homework_pending:         number
  variants_completed:       number
  telegram_connected:       number
  visits_today:             number
  visits_7d:                number
}

const EMPTY: SchoolStats = {
  teachers: 0, students: 0, courses: 0,
  homework_submitted_total: 0, homework_submitted_7d: 0,
  homework_reviewed: 0, homework_pending: 0,
  variants_completed: 0, telegram_connected: 0,
  visits_today: 0, visits_7d: 0,
}

export function useSchoolStats() {
  const [stats,   setStats]   = useState<SchoolStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(supabase as any).rpc('admin_school_stats').then(
      ({ data, error: rpcError }: { data: unknown; error: { message?: string } | null }) => {
        if (cancelled) return
        if (rpcError) {
          // Показываем причину словами, а не пустые нули: молчащий дашборд —
          // это тот же класс отказа, что §47.
          setError(
            String(rpcError.message ?? '').includes('ONLY_ADMIN_SEES_SCHOOL_STATS')
              ? 'Статистику школы видит только администратор'
              : rpcError.message || 'Не удалось загрузить статистику школы'
          )
          setStats(null)
        } else {
          setStats({ ...EMPTY, ...(data as Partial<SchoolStats> | null) })
        }
        setLoading(false)
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику школы')
        setStats(null)
        setLoading(false)
      },
    )

    return () => { cancelled = true }
  }, [tick])

  return { stats, loading, error, reload }
}
