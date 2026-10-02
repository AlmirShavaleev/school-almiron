import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toastStore'
import { useAchievementsBadge } from '@/store/achievementsStore'
import { achievementToastText, normalizeAchievements, type Achievements } from '@/lib/achievements'

/**
 * §257. Награды ученика одним вызовом `student_achievements_sync()` (definer,
 * от auth.uid()): база досчитывает «have», вставляет недостающие полученные и
 * отдаёт все 79. Вставленные этим вызовом приходят с `fresh` — тост «Новая
 * награда» показывается ровно один раз: второй вызов их уже не вставит.
 *
 * Тост шлётся даже если компонент успел размонтироваться (StrictMode,
 * быстрый переход): иначе награду, вставленную «отменённым» вызовом, не
 * увидел бы никто — повторный sync её уже не считает свежей.
 *
 * `markSeen` — страница «Достижения»: после загрузки все новые отмечаются
 * просмотренными (`mark_achievements_seen`), счётчик в меню гаснет; метки
 * «новая» на плитках остаются до ухода со страницы.
 *
 * `claimForecast` — главная сообщает прогноз (модель живёт на клиенте); база
 * проверяет правдоподобие и даёт значок без баллов школы.
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

const TOAST_MS = 8000

export function useAchievements(profileId: string | null | undefined, opts: { markSeen?: boolean; onFresh?: () => void } = {}) {
  const [data, setData] = useState<Achievements | null>(null)
  const [loading, setLoading] = useState(Boolean(profileId))
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])
  const setNewCount = useAchievementsBadge(s => s.setNewCount)
  const markSeen = opts.markSeen === true
  const onFreshRef = useRef(opts.onFresh)
  useEffect(() => { onFreshRef.current = opts.onFresh })
  /** Ключи, вставленные claim'ом: их тост — после перечитывания списка. */
  const extraFresh = useRef<string[]>([])

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
        const { data: raw, error: err } = await db.rpc<unknown>('student_achievements_sync')
        if (err) throw new Error(err.message ?? 'Не удалось загрузить награды')
        const parsed = normalizeAchievements(raw)
        if (!parsed) throw new Error('Пустой ответ')
        const extra = extraFresh.current
        extraFresh.current = []
        const fresh = parsed.items.filter(i => i.fresh || extra.includes(i.key))
        const text = achievementToastText(fresh)
        if (text) toast.success(text, TOAST_MS)
        if (fresh.some(i => i.points > 0)) onFreshRef.current?.()
        if (cancelled) return
        setData(parsed)
        if (markSeen && parsed.newCount > 0) {
          const { error: seenErr } = await db.rpc<number>('mark_achievements_seen')
          setNewCount(seenErr ? parsed.newCount : 0)
        } else {
          setNewCount(markSeen ? 0 : parsed.newCount)
        }
      } catch (e) {
        if (cancelled) return
        setData(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить награды')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profileId, attempt, markSeen, setNewCount])

  /** Сообщить прогноз по предмету; новые значки — тостом после перечитывания. */
  const claimForecast = useCallback(async (subject: string, first: number, current: number): Promise<string[]> => {
    const db = supabase as unknown as RpcLike
    if (typeof db.rpc !== 'function') return []
    const { data: raw, error: err } = await db.rpc<{ fresh?: unknown }>('claim_forecast_achievement', {
      p_subject: subject, p_first_score: first, p_current_score: current,
    })
    if (err || !raw) return []
    const fresh = Array.isArray(raw.fresh) ? raw.fresh.filter((k): k is string => typeof k === 'string') : []
    if (fresh.length > 0) {
      extraFresh.current = [...extraFresh.current, ...fresh]
      retry()
    }
    return fresh
  }, [retry])

  return { data, loading, error, retry, claimForecast }
}
