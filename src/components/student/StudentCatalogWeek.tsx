import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { plural } from '@/lib/plural'

/**
 * §256. Учитель в карточке ученика: «Каталог за 7 дней: решено N, верно M».
 * «Решено» — задачи с проверенным ответом, «верно» — засчитанные (верно без
 * открытого ответа). Считает `student_catalog_week_for_staff` (definer,
 * только персонал курса ученика или админ). Ошибка или функции ещё нет —
 * строки нет вовсе.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function StudentCatalogWeek({ studentId }: { studentId: string }) {
  const [v, setV] = useState<{ tried: number; correct: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const db = supabase as unknown as RpcLike
      if (typeof db.rpc !== 'function') return
      const { data, error } = await db.rpc<{ tried?: unknown; correct?: unknown }>('student_catalog_week_for_staff', { p_student_id: studentId })
      if (cancelled) return
      if (error || !data) { setV(null); return }
      setV({ tried: Number(data.tried) || 0, correct: Number(data.correct) || 0 })
    }
    void load()
    return () => { cancelled = true }
  }, [studentId])
  if (!v) return null
  return (
    <p data-testid="student-catalog-week" className="rounded-xl bg-white px-4 py-2.5 text-sm text-graphite-600 ring-1 ring-graphite-200">
      <b className="font-extrabold text-graphite-900">Каталог за 7 дней:</b>{' '}
      решено {v.tried} {plural(v.tried, 'задача', 'задачи', 'задач')}, верно {v.correct}
      <span className="text-graphite-400"> · с проверкой ответа; задачи с открытым ответом не засчитаны</span>
    </p>
  )
}
