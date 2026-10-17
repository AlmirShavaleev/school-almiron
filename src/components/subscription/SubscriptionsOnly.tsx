import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'

/**
 * Экран подписки — только тем, кому подписка включена (`subscription_enabled`:
 * флаг × тестировщики, §287). Остальным — на главную: прямой адрес
 * `/subscription`, `/subscribe/checkout/…`, `/diagnostic/result` не показывает
 * ни цен, ни формы оплаты (письмо ЛК_выкатка_в_main_проверка.md, 16.10).
 * Пока флаг грузится — пусто, без мигания витрины.
 */
export function SubscriptionsOnly({ children }: { children: ReactNode }) {
  const subs = useSubscriptionsEnabled()
  if (subs.loading) return null
  if (!subs.enabled) return <Navigate to="/" replace />
  return <>{children}</>
}
