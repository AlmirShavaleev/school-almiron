import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeForecastResponse, type ForecastResponse } from '@/lib/egeForecast'
import type { EgeSubject } from '@/lib/egeScales'

/**
 * §255. Свидетельства для «Примерного балла на ЕГЭ» одним вызовом
 * `student_exam_forecast_evidence()` (definer, от auth.uid() — параметра «чей»
 * нет) и запись своей цели `set_my_exam_goal(subject, goal)`.
 *
 * Модель считает клиент (`egeForecast.ts`): база отдаёт только строки. Ошибка
 * (в том числе «функции нет», пока миграция не применена) главную не роняет —
 * карточка показывает строку с повтором.
 *
 * Тип вызова — свой, а не из `database.ts`: сгенерированные типы базы отстают
 * от прода и руками не дописываются (CLAUDE.md).
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useExamForecast(profileId: string | null | undefined) {
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(profileId))
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!profileId) { setData(null); setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data: raw, error: err } = await db.rpc<unknown>('student_exam_forecast_evidence')
        if (cancelled) return
        if (err) throw new Error(err.message ?? 'Не удалось загрузить прогноз')
        const parsed = normalizeForecastResponse(raw)
        if (!parsed) throw new Error('Пустой ответ')
        setData(parsed)
      } catch (e) {
        if (cancelled) return
        setData(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить прогноз')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profileId, attempt])

  /** Поставить / снять (null) свою цель. Бросает ошибку с текстом базы. */
  const setGoal = useCallback(async (subject: EgeSubject, goal: number | null) => {
    const db = supabase as unknown as RpcLike
    if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
    const { error: err } = await db.rpc<number | null>('set_my_exam_goal', { p_subject: subject, p_goal: goal })
    if (err) throw new Error(err.message ?? 'Не удалось сохранить цель')
    setData(d => d && {
      ...d,
      subjects: d.subjects.map(s => (s.subject === subject ? { ...s, goal } : s)),
    })
  }, [])

  return { data, loading, error, retry, setGoal }
}
