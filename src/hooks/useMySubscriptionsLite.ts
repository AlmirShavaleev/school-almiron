import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { fetchMySubscriptions } from '@/lib/subscription/api'
import type { MySubscription } from '@/lib/subscription/view'

/**
 * Подписки ученика для метки «до …» (меню «Ещё», строка свойств главной) — тот же `my_subscriptions`, что карточки
 * «Мои подписки» (access_until), а не student_path_home: там ещё и пробный, и
 * метка расходилась с карточкой. Без react-query: меню рендерится и там, где
 * QueryClientProvider нет (тесты раскладки), как раньше useStudentPathHome.
 */
export function useMySubscriptionsLite(enabled: boolean): MySubscription[] | null {
  const uid = useAuthStore(s => s.profile?.id ?? null)
  const key = enabled && uid ? uid : null
  const [got, setGot] = useState<{ key: string; data: MySubscription[] } | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    fetchMySubscriptions()
      .then(d => { if (alive) setGot({ key, data: d ?? [] }) })
      .catch(() => { /* нет сети — метку не показываем */ })
    return () => { alive = false }
  }, [key])
  return got && got.key === key ? got.data : null
}
