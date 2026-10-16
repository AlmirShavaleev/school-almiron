import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { activityGrid, type ActivityGrid, type ActivityRaw } from '@/lib/studentActivity'

/**
 * «Посещения по дням» на главной ученика (этап 2 ЛК, письмо 15.10):
 * `student_home_activity(84)` — одна RPC: дни заходов, решённые задачи, серия.
 * Только чтение; сбой — блок не показывается, главная цела.
 */
export function useStudentActivity(enabled: boolean, today: string, days = 84) {
  const [grid, setGrid] = useState<ActivityGrid | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    supabase.rpc('student_home_activity' as never, { p_days: days } as never).then(({ data, error }) => {
      if (!alive || error) return
      // Недель — с запасом на неделю начала: календарь месяца листает до 3 месяцев назад.
      setGrid(activityGrid(data as ActivityRaw | null, today, Math.ceil(days / 7) + 1))
    })
    return () => { alive = false }
  }, [enabled, today, days])
  return grid
}
