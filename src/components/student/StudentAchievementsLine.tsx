import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeStaffAchievements, type StaffAchievements } from '@/lib/achievements'

/**
 * §257. Учитель в карточке ученика: «Достижения: N из 79 · последние: 20 ДЗ,
 * Серия 7 дней, Без ошибок». Только сохранённые награды ученика (досчитывает
 * их сам ученик, заходя на главную) — `student_achievements_for_staff`
 * (definer, персонал курса ученика или админ). Ошибка или функции ещё нет —
 * строки нет вовсе.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function StudentAchievementsLine({ studentId }: { studentId: string }) {
  const [v, setV] = useState<StaffAchievements | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const db = supabase as unknown as RpcLike
      if (typeof db.rpc !== 'function') return
      const { data, error } = await db.rpc<unknown>('student_achievements_for_staff', { p_student_id: studentId })
      if (cancelled) return
      setV(error ? null : normalizeStaffAchievements(data))
    }
    void load()
    return () => { cancelled = true }
  }, [studentId])
  if (!v) return null
  return (
    <p data-testid="student-achievements-line" className="rounded-xl bg-white px-4 py-2.5 text-sm text-graphite-600 ring-1 ring-graphite-200">
      <b className="font-extrabold text-graphite-900">Достижения:</b>{' '}
      {v.earned} из {v.total}
      {v.latest.length > 0 && <span> · последние: {v.latest.join(', ')}</span>}
    </p>
  )
}
