import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeCatalogOverview, type CatalogOverview } from '@/lib/catalogOverview'
import { isCatalogLockedError } from '@/lib/catalogLock'

/**
 * §246. Главная каталога одним вызовом `catalog_my_overview()`.
 *
 * Перечитывается при каждом заходе на страницу (без кэша): ученик отмечает
 * задачу «Выполнено» внутри номера и возвращается сюда — столбик обязан
 * вырасти сразу.
 *
 * Ошибка (в том числе «функции нет», если фронт приедет раньше миграции) не
 * роняет страницу: `overview` остаётся null, экран рисует карточки экзаменов
 * с числами из DIRECTIONS и предлагает повторить.
 */

type Res<T> = { data: T | null; error: { message?: string; hint?: string | null } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

export function useCatalogOverview(userId: string | null | undefined) {
  const [overview, setOverview] = useState<CatalogOverview | null>(null)
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState<string | null>(null)
  // §292: закрыто всё (нет подписки ни на один предмет) — плашка, не ошибка
  const [locked, setLocked] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Состояние меняется только после await: вызов setState прямо в теле
      // эффекта даёт лишний каскадный рендер (react-hooks/set-state-in-effect).
      await Promise.resolve()
      if (cancelled) return
      if (!userId) {
        setOverview(null)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setLocked(false)
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')
        const { data, error: err } = await db.rpc<unknown>('catalog_my_overview', {})
        if (cancelled) return
        if (isCatalogLockedError(err)) { setOverview(null); setLocked(true); return }
        if (err) throw new Error(err.message ?? 'Не удалось загрузить статистику')
        const parsed = normalizeCatalogOverview(data)
        if (!parsed) throw new Error('Пустой ответ')
        setOverview(parsed)
      } catch (e) {
        if (cancelled) return
        setOverview(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить статистику')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [userId, attempt])

  return { overview, loading, error, locked, retry }
}
