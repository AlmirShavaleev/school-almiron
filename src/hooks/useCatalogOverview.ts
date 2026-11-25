import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeCatalogOverview, type CatalogOverview } from '@/lib/catalogOverview'
import { isCatalogLockedError } from '@/lib/catalogLock'

type Res<T> = { data: T | null; error: { message?: string; hint?: string | null } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

type State = {
  directions: string[]
  overview: CatalogOverview | null
  loading: boolean
  error: string | null
  locked: boolean
}

const EMPTY: State = { directions: [], overview: null, loading: false, error: null, locked: false }
const LOADING: State = { ...EMPTY, loading: true }
const LOCKED: State = { ...EMPTY, locked: true }

export function useCatalogOverview(userId: string | null | undefined, role?: string) {
  const [attempt, setAttempt] = useState(0)
  const key = userId ? `${userId}|${role ?? ''}|${attempt}` : null
  const [result, setResult] = useState<{ key: string; state: State } | null>(null)
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const update = (state: State) => {
      if (!cancelled) setResult({ key, state })
    }

    async function load() {
      let directions: string[] = []
      try {
        const db = supabase as unknown as RpcLike
        if (typeof db.rpc !== 'function') throw new Error('rpc недоступен')

        const access = await db.rpc<unknown>('catalog_subscription_directions', {})
        if (cancelled) return
        if (isCatalogLockedError(access.error)) {
          update(LOCKED)
          return
        }
        if (access.error) throw new Error(access.error.message ?? 'Не удалось проверить доступ')
        if (!Array.isArray(access.data) || !access.data.every(item => typeof item === 'string')) {
          throw new Error('Не удалось проверить доступ')
        }
        directions = access.data
        if (directions.length === 0) {
          update(LOCKED)
          return
        }
        update({ ...LOADING, directions })

        // Прогресс читается при каждом открытии, чтобы сразу учесть новые отметки.
        const { data, error: err } = await db.rpc<unknown>('catalog_my_overview', {})
        if (isCatalogLockedError(err)) {
          update(LOCKED)
          return
        }
        if (err) throw new Error(err.message ?? 'Не удалось загрузить статистику')
        const overview = normalizeCatalogOverview(data)
        if (!overview) throw new Error('Пустой ответ')
        update({ ...EMPTY, directions, overview })
      } catch (e) {
        update({ ...EMPTY, directions, error: e instanceof Error ? e.message : 'Не удалось загрузить каталог' })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [key])

  const state = key ? (result?.key === key ? result.state : LOADING) : EMPTY
  return { ...state, retry }
}
