import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  checkErrorText, normalizeCheckResult, normalizeDailyTask, normalizeWeeklyGoal,
  type CheckResult, type DailyTask, type WeeklyGoal,
} from '@/lib/catalogRewards'

/**
 * §256. Главная: «Задача дня» (`student_daily_task`) и «Цель недели»
 * (`student_weekly_goal`) по предмету ЕГЭ ученика. Обе — definer от
 * auth.uid(); выбор номера и задачи делает база и фиксирует на день/неделю.
 * Ответ на задачу дня — та же `catalog_check_answer`, что в каталоге.
 * Ошибка (в том числе «функции нет», пока миграция не применена) главную не
 * роняет — карточек просто нет.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const db = supabase as unknown as RpcLike
  if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
  const { data, error } = await db.rpc<T>(fn, args)
  if (error) throw new Error(error.message ?? 'Ошибка базы')
  return data
}

export function useHomeCatalog(subject: string | null) {
  const [daily, setDaily] = useState<DailyTask | null>(null)
  const [weekly, setWeekly] = useState<WeeklyGoal | null>(null)
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!subject) { setDaily(null); setWeekly(null); return }
      const [d, w] = await Promise.allSettled([
        call<unknown>('student_daily_task', { p_subject: subject }),
        call<unknown>('student_weekly_goal', { p_subject: subject }),
      ])
      if (cancelled) return
      setDaily(d.status === 'fulfilled' ? normalizeDailyTask(d.value) : null)
      setWeekly(w.status === 'fulfilled' ? normalizeWeeklyGoal(w.value) : null)
    }
    void load()
    return () => { cancelled = true }
  }, [subject, attempt])

  const check = useCallback(async (taskId: string, answer: string): Promise<{ result: CheckResult | null; error: string | null }> => {
    try {
      const result = normalizeCheckResult(await call<unknown>('catalog_check_answer', { p_task_id: taskId, p_answer: answer }))
      if (!result) return { result: null, error: checkErrorText(null) }
      if (result.verdict === 'correct') {
        setDaily(d => (d && d.task?.id === taskId ? { ...d, solved: true, done: d.done || result.counted, attempts: d.attempts + 1 } : d))
        if (result.weekly) setWeekly(w => (w ? { ...w, progress: result.weekly!.progress, done: result.weekly!.progress >= w.target } : w))
      } else {
        setDaily(d => (d && d.task?.id === taskId ? { ...d, attempts: d.attempts + 1 } : d))
      }
      return { result, error: null }
    } catch (e) {
      return { result: null, error: checkErrorText(e instanceof Error ? e.message : null) }
    }
  }, [])

  return { daily, weekly, reload, check }
}
