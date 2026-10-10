/**
 * §282. «Моя подписка» (`/my-subscription`, ученик): статус, до какого
 * числа, следующее списание, карта, отменить/включить автопродление,
 * оплатить вручную, история платежей. Сначала вывод — потом таблица.
 */
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useMySubscriptions, useSetAutoRenew } from '@/hooks/useSubscription'
import {
  PAYMENT_LABEL,
  STATUS_LABEL,
  describeSubscription,
  formatRub,
  formatShortDateMsk,
  paymentHistory,
  promoLine,
  periodLabel,
  type MySubscription,
  type Tone,
} from '@/lib/subscription/view'

const BADGE: Record<Tone, 'success' | 'warning' | 'error' | 'default'> = {
  success: 'success', warning: 'warning', error: 'error', default: 'default',
}

function SubscriptionCard({ s }: { s: MySubscription }) {
  const v = describeSubscription(s)
  const toggle = useSetAutoRenew()
  const history = paymentHistory(s)
  const promo = promoLine(s.promo)

  return (
    <section className="platform-surface rounded-card p-5 sm:p-6" data-testid="my-subscription-card" data-status={s.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-semibold text-graphite-900">{s.course_title}</h2>
        <Badge variant={BADGE[v.tone]}>{STATUS_LABEL[s.status]}</Badge>
      </div>
      <p className="mt-1 text-[13px] text-graphite-500">{s.tariff_title} · {formatRub(s.price_rub)} {periodLabel(s.period_months ?? 1)}</p>

      <p className="mt-4 text-[17px] text-graphite-900" data-testid="my-subscription-headline">{v.headline}</p>
      {v.details.map((d) => <p key={d} className="mt-1 text-[15px] text-graphite-700">{d}</p>)}
      {promo && <p className="mt-1 text-[15px] text-verdict-ok-ink" data-testid="my-subscription-promo">{promo}</p>}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {s.has_access && s.group_id && (
          <Link to={`/my-course/${s.group_id}`}><Button>Открыть курс</Button></Link>
        )}
        {v.canPay && (
          <Link to={`/subscribe/checkout/${s.tariff_id}`}>
            <Button variant={s.has_access ? 'secondary' : 'primary'} data-testid="my-subscription-pay">{v.payLabel}</Button>
          </Link>
        )}
        {v.canCancelAutoRenew && (
          <Button
            variant="ghost"
            loading={toggle.isPending}
            onClick={() => {
              if (window.confirm('Отключить автопродление? Курс останется открытым до конца оплаченного периода.')) {
                toggle.mutate({ id: s.id, on: false })
              }
            }}
            data-testid="my-subscription-cancel-renew"
          >
            Отменить автопродление
          </Button>
        )}
        {v.canEnableAutoRenew && (
          <Button variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate({ id: s.id, on: true })} data-testid="my-subscription-enable-renew">
            Включить автопродление
          </Button>
        )}
      </div>
      {toggle.error && <p className="mt-2 text-[13px] text-verdict-bad-ink">✕ {(toggle.error as Error).message}</p>}

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[.03em] text-graphite-500">История платежей</h3>
          <table className="mt-2 w-full text-[15px]" data-testid="my-subscription-payments">
            <tbody>
              {history.map((p) => (
                <tr key={p.id} className="border-b border-graphite-200 last:border-0">
                  <td className="py-2 pr-3 text-graphite-700">{formatShortDateMsk(p.paid_at ?? p.created_at)}</td>
                  <td className="py-2 pr-3">{p.kind === 'renewal' ? 'Автопродление' : 'Оплата'}</td>
                  <td className="py-2 pr-3 text-right">
                    {formatRub(p.amount_rub)}
                    {(p.discount_rub ?? 0) > 0 && (
                      <span className="block text-[13px] text-graphite-500">скидка {formatRub(p.discount_rub ?? 0)}</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-graphite-500">{PAYMENT_LABEL[p.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function MySubscriptionPage() {
  const [params] = useSearchParams()
  const { data, isLoading, error } = useMySubscriptions()

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="text-[28px] font-semibold text-graphite-900">Моя подписка</h1>
      {params.get('started') === 'trial' && (
        <p className="mt-3 rounded-lg bg-verdict-ok-tint px-4 py-3 text-[15px] text-verdict-ok-ink">Пробный период начался — курс открыт.</p>
      )}
      {params.get('started') === 'promo' && (
        <p className="mt-3 rounded-lg bg-verdict-ok-tint px-4 py-3 text-[15px] text-verdict-ok-ink" data-testid="my-subscription-promo-started">
          Промокод применён — курс открыт.
        </p>
      )}
      {isLoading && <p className="mt-4 text-graphite-500">Загружаем…</p>}
      {error && <p className="mt-4 text-verdict-bad-ink">Не удалось загрузить подписку. Обновите страницу.</p>}
      {!isLoading && !error && (data ?? []).length === 0 && (
        <div className="platform-surface mt-6 rounded-card p-6">
          <p className="text-[17px] text-graphite-900">Подписки пока нет.</p>
          <Link to="/subscribe" className="mt-4 inline-block"><Button>Выбрать тариф</Button></Link>
        </div>
      )}
      <div className="mt-6 space-y-4">
        {(data ?? []).map((s) => <SubscriptionCard key={s.id} s={s} />)}
      </div>
    </div>
  )
}
