/**
 * §282 «Подписка» — хуки экранов. Флаг `subscriptions` читается из
 * `app_feature_flags`; выключен или не прочитался — экраны подписки молчат.
 *
 * Флаг и доступ к курсу — без react-query: их зовут меню и страница курса,
 * которые живут (и тестируются) и без QueryClientProvider. Ошибка чтения =
 * «ничего не показывать», страница не падает.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCourseAccess,
  fetchFeatureFlag,
  fetchMySubscriptions,
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

function loadFlag(key: string): Promise<boolean> {
  const hit = flagCache.get(key)
  if (hit?.pending) return hit.pending
  if (hit && Date.now() - hit.at < FLAG_TTL_MS) return Promise.resolve(hit.value)
  const pending = fetchFeatureFlag(key)
    .catch(() => false)
    .then((value) => {
      flagCache.set(key, { value, at: Date.now() })
      return value
    })
  flagCache.set(key, { value: hit?.value ?? false, at: hit?.at ?? 0, pending })
  return pending
}

export function useFeatureFlag(key: string) {
  const cached = flagCache.get(key)
  const [state, setState] = useState<{ enabled: boolean; loading: boolean }>({
    enabled: cached?.value ?? false,
    loading: !cached || !!cached.pending,
  })
  useEffect(() => {
    let alive = true
    loadFlag(key).then((enabled) => {
      if (alive) setState({ enabled, loading: false })
    })
    return () => {
      alive = false
    }
  }, [key])
  return state
}

export function useSubscriptionsEnabled() {
  return useFeatureFlag(SUBSCRIPTION_FLAG)
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
