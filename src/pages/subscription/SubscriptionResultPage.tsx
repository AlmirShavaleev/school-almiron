/**
 * §282. Возврат со страницы ЮKassa (`/subscribe/result?payment=<id>`).
 *
 * Итог платежа приходит вебхуком, а не адресной строкой: страница опрашивает
 * СВОЮ строку `subscription_payments` (RLS — только свои) каждые 3 секунды
 * до минуты. Старая `PaymentResultPage` (`/payment-result`) не трогается.
 */
import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { fetchPayment } from '@/lib/subscription/api'
import { useMySubscriptions } from '@/hooks/useSubscription'
import { formatDateMsk, resultState } from '@/lib/subscription/view'

const POLL_MS = 3000
const POLL_LIMIT = 20

export function SubscriptionResultPage() {
  const [params] = useSearchParams()
  const paymentId = params.get('payment')
  const qc = useQueryClient()
  const key = ['subscription', 'payment', paymentId]

  const payment = useQuery({
    queryKey: key,
    queryFn: () => fetchPayment(paymentId as string),
    enabled: !!paymentId,
    refetchInterval: (q) => {
      const st = resultState(q.state.data?.status)
      return (st === 'waiting' || st === 'unknown') && q.state.dataUpdateCount < POLL_LIMIT ? POLL_MS : false
    },
  })
  const polls = payment.isFetched ? (qc.getQueryState(key)?.dataUpdateCount ?? 0) : 0

  const state = resultState(payment.data?.status)
  useEffect(() => {
    if (state === 'succeeded') void qc.invalidateQueries({ queryKey: ['subscription'] })
  }, [state, qc])

  const mine = useMySubscriptions(state === 'succeeded')
  const sub = (mine.data ?? []).find((s) => s.id === payment.data?.subscription_id)

  let body: React.ReactNode
  if (!paymentId) {
    body = <p className="text-[17px]">Не нашли платёж. Проверьте раздел «Моя подписка».</p>
  } else if (state === 'succeeded') {
    body = (
      <>
        <p className="text-[20px] font-semibold text-verdict-ok-ink">Подписка оформлена</p>
        {sub?.access_until && <p className="mt-1 text-[17px]">Курс «{sub.course_title}» открыт до {formatDateMsk(sub.access_until)}.</p>}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {sub?.group_id && <Link to={`/my-course/${sub.group_id}`}><Button>Перейти к курсу</Button></Link>}
          <Link to="/my-subscription"><Button variant="secondary">Моя подписка</Button></Link>
        </div>
      </>
    )
  } else if (state === 'failed') {
    body = (
      <>
        <p className="text-[20px] font-semibold text-verdict-bad-ink">Оплата не прошла</p>
        <p className="mt-1 text-[15px] text-graphite-700">Деньги не списаны. Можно попробовать ещё раз или другой картой.</p>
        <Link to="/subscribe" className="mt-5 inline-block"><Button>Попробовать снова</Button></Link>
      </>
    )
  } else if (state === 'refunded') {
    body = <p className="text-[17px]">Платёж возвращён.</p>
  } else if (polls >= POLL_LIMIT) {
    body = (
      <>
        <p className="text-[17px]">Банк ещё не подтвердил оплату.</p>
        <p className="mt-1 text-[15px] text-graphite-500">Обычно это занимает минуту. Статус появится в разделе «Моя подписка».</p>
        <Link to="/my-subscription" className="mt-5 inline-block"><Button variant="secondary">Моя подписка</Button></Link>
      </>
    )
  } else {
    body = (
      <p className="flex items-center gap-3 text-[17px]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        Проверяем оплату…
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6" data-testid="subscription-result" data-state={state}>
      <div className="platform-surface rounded-card p-6 text-graphite-900">{body}</div>
    </div>
  )
}
