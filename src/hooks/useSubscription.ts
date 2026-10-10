/**
 * §282 «Подписка» — хуки экранов. Включена ли подписка для пользователя —
 * решает база (`subscription_enabled`: флаг × режим «только тестировщики»,
 * §287); выключена или не прочиталась — экраны подписки молчат.
 *
 * Флаг и доступ к курсу — без react-query: их зовут меню и страница курса,
 * которые живут (и тестируются) и без QueryClientProvider. Ошибка чтения =
 * «ничего не показывать», страница не падает.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import {
  fetchCourseAccess,
  fetchFeatureFlag,
  fetchMySubscriptions,
  fetchSubscriptionsEnabled,
  fetchPublicTariffs,
  fetchSubscriptionSettings,
  setAutoRenew,
  type CourseAccess,
} from '@/lib/subscription/api'

export const SUBSCRIPTION_FLAG = 'subscriptions'

const FLAG_TTL_MS = 5 * 60_000
const flagCache = new Map<string, { value: boolean; at: number; pending?: Promise<boolean> }>()

/** Для тестов: забыть прочитанные флаги. */
export function resetFeatureFlagCache() {
  flagCache.clear()
}

function loadFlag(key: string, fetcher: () => Promise<boolean> = () => fetchFeatureFlag(key)): Promise<boolean> {
  const hit = flagCache.get(key)
  if (hit?.pending) return hit.pending
  if (hit && Date.now() - hit.at < FLAG_TTL_MS) return Promise.resolve(hit.value)
  const pending = fetcher()
    .catch(() => false)
    .then((value) => {
      flagCache.set(key, { value, at: Date.now() })
      return value
    })
  flagCache.set(key, { value: hit?.value ?? false, at: hit?.at ?? 0, pending })
  return pending
}

function useCachedFlag(key: string, fetcher?: () => Promise<boolean>) {
  const cached = flagCache.get(key)
  const [state, setState] = useState<{ key: string; enabled: boolean; loading: boolean }>({
    key,
    enabled: cached?.value ?? false,
    loading: !cached || !!cached.pending,
  })
  useEffect(() => {
    let alive = true
    loadFlag(key, fetcher).then((enabled) => {
      if (alive) setState({ key, enabled, loading: false })
    })
    return () => {
      alive = false
    }
    // fetcher определяется ключом; ключ меняется вместе с пользователем
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // ответ привязан к ключу: после смены пользователя старый не показывается
  return state.key === key ? { enabled: state.enabled, loading: state.loading } : { enabled: false, loading: true }
}

export function useFeatureFlag(key: string) {
  return useCachedFlag(key)
}

/**
 * Подписка включена для ЭТОГО пользователя (флаг × тестировщики, §287).
 * Кэш — по пользователю: вход другого ученика не наследует чужой ответ.
 */
export function useSubscriptionsEnabled() {
  const uid = useAuthStore((s) => s.profile?.id ?? 'anon')
  return useCachedFlag(`${SUBSCRIPTION_FLAG}:${uid}`, fetchSubscriptionsEnabled)
}

export function usePublicTariffs() {
  return useQuery({ queryKey: ['subscription', 'tariffs'], queryFn: fetchPublicTariffs, staleTime: 60_000 })
}

export function useSubscriptionSettings() {
  return useQuery({ queryKey: ['subscription', 'settings'], queryFn: fetchSubscriptionSettings, staleTime: 5 * 60_000 })
}

export function useMySubscriptions(enabled = true) {
  return useQuery({ queryKey: ['subscription', 'mine'], queryFn: fetchMySubscriptions, enabled })
}

export function useCourseAccess(courseId: string | null | undefined) {
  // ответ привязан к курсу: при смене курса старый ответ не показывается
  const [got, setGot] = useState<{ courseId: string; data: CourseAccess | null } | null>(null)
  useEffect(() => {
    if (!courseId) return
    let alive = true
    fetchCourseAccess(courseId)
      .then((d) => { if (alive) setGot({ courseId, data: d ?? null }) })
      .catch(() => { /* нет функции / нет сети — плашку не показываем */ })
    return () => {
      alive = false
    }
  }, [courseId])
  return { data: got && got.courseId === courseId ? got.data : null }
}

export function useSetAutoRenew() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setAutoRenew(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription'] }),
  })
}
