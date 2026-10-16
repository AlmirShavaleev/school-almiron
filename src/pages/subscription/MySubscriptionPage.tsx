/**
 * §282. «Моя подписка» (`/my-subscription`, ученик): статус, до какого
 * числа, следующее списание, отменить/включить автопродление, оплатить
 * вручную, история платежей.
 *
 * §290-B (тест 12.10): подтверждение — модалкой платформы, не window.confirm;
 * после ответа базы карточка обновляется сразу (useSetAutoRenew).
 *
 * В стиле ЛК без дублей (письмо ЛК_стиль_курсы_и_моя_подписка_без_дублей.md,
 * 16.10): публичное название курса; одна строка статуса вместо трёх и тариф
 * пилюлей; «Оплатить следующий месяц» при включённом автопродлении не
 * показываем (дублирует списание) — только «Продлить заранее» за 3 дня;
 * «Отменить автопродление» — тихой ссылкой; история платежей свёрнута.
 * Правила — src/lib/subscription/cardView.ts.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Sticker } from '@/components/student/skin/Sticker'
import { useMySubscriptions, useSetAutoRenew } from '@/hooks/useSubscription'
import {
  PAYMENT_LABEL,
  formatRub,
  formatShortDateMsk,
  paymentHistory,
  promoLine,
  type MySubscription,
} from '@/lib/subscription/view'
import { subscriptionCardView, type StatusKind } from '@/lib/subscription/cardView'
import { loadCourseExtras } from '@/lib/courseMeta'
import { publicTitle } from '@/lib/myCourses'

const STATUS_TAG: Record<StatusKind, { cls: string; text: string }> = {
  active: { cls: 'stu-tag t-green', text: 'Активна' },
  renew_off: { cls: 'stu-tag t-blue', text: 'Активна' },
  past_due: { cls: 'stu-tag t-or', text: 'Не продлилась' },
  trial: { cls: 'stu-tag t-or', text: 'Пробный период' },
  ended: { cls: 'stu-tag t-grey', text: 'Закончилась' },
  pending: { cls: 'stu-tag t-grey', text: 'Не оплачена' },
}

function SubscriptionCard({ s, title }: { s: MySubscription; title: string }) {
  const v = subscriptionCardView(s)
  const toggle = useSetAutoRenew()
  const [asking, setAsking] = useState<'off' | 'on' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const history = paymentHistory(s)
  const promo = promoLine(s.promo)
  const tag = STATUS_TAG[v.kind]

  return (
    <section className="stu-card stu-sub" data-testid="my-subscription-card" data-status={s.status} data-kind={v.kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={tag.cls}>{tag.text}</span>
            {v.tariff && <span className="stu-tag t-grey" data-testid="my-subscription-tariff">{v.tariff}</span>}
          </div>
          <h2 className="stu-h3 mt-2 break-words" data-testid="my-subscription-title">{title}</h2>
        </div>
        <Sticker name="calendar25" size={56} />
      </div>

      <p className="text-[15.5px] font-semibold" data-testid="my-subscription-headline">{v.line}</p>
      {promo && <p className="text-[14px] font-semibold text-[var(--greenInk)]" data-testid="my-subscription-promo">{promo}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {s.has_access && s.group_id && (
          <Link to={`/my-course/${s.group_id}`} className="stu-btn stu-btn-p">Открыть курс</Link>
        )}
        {v.pay && (
          <Link
            to={`/subscribe/checkout/${s.tariff_id}`}
            className={v.pay.primary ? (s.has_access ? 'stu-btn stu-btn-o' : 'stu-btn stu-btn-p') : 'stu-btn stu-btn-g'}
            data-testid="my-subscription-pay"
          >
            {v.pay.label}
          </Link>
        )}
        {v.canEnableAutoRenew && (
          <button
            type="button"
            className="stu-btn stu-btn-g"
            disabled={toggle.isPending}
            onClick={() => setAsking('on')}
            data-testid="my-subscription-enable-renew"
          >
            Включить автопродление
          </button>
        )}
      </div>
      {toggle.error && <p className="text-[13px] text-[var(--redInk)]">✕ {(toggle.error as Error).message}</p>}

      {history.length > 0 && (
        <div className="stu-sub-history">
          <button
            type="button"
            className="stu-sub-history-toggle"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(o => !o)}
            data-testid="my-subscription-history-toggle"
          >
            История платежей ({history.length})
            <ChevronDown size={16} aria-hidden className={historyOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          {historyOpen && (
            <table className="mt-2 w-full text-[14.5px]" data-testid="my-subscription-payments">
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3">{formatShortDateMsk(p.paid_at ?? p.created_at)}</td>
                    <td className="py-2 pr-3 text-right font-semibold">
                      {formatRub(p.amount_rub)}
                      {(p.discount_rub ?? 0) > 0 && (
                        <span className="stu-muted block text-[12.5px] font-medium">скидка {formatRub(p.discount_rub ?? 0)}</span>
                      )}
                    </td>
                    <td className="stu-muted py-2 text-right">{PAYMENT_LABEL[p.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {v.canCancelAutoRenew && (
        <button
          type="button"
          className="stu-sub-quiet"
          disabled={toggle.isPending}
          onClick={() => setAsking('off')}
          data-testid="my-subscription-cancel-renew"
        >
          Отменить автопродление
        </button>
      )}

      <ConfirmDialog
        open={asking != null}
        title={asking === 'off' ? 'Отключить автопродление?' : 'Включить автопродление?'}
        text={asking === 'off'
          ? 'Курс останется открытым до конца оплаченного периода, дальше деньги списываться не будут.'
          : 'Следующий период оплатится автоматически сохранённым способом оплаты. Отключить можно в любой момент.'}
        confirmLabel={asking === 'off' ? 'Отключить' : 'Включить'}
        cancelLabel={asking === 'off' ? 'Оставить' : 'Отмена'}
        busy={toggle.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={() => toggle.mutate({ id: s.id, on: asking === 'on' }, { onSettled: () => setAsking(null) })}
        testId="auto-renew-confirm"
      />
    </section>
  )
}

export function MySubscriptionPage() {
  const [params] = useSearchParams()
  const { data, isLoading, error } = useMySubscriptions()
  // Публичное название курса (витрина), как в «Моих курсах»: без «— подписка (тест)».
  const [showcase, setShowcase] = useState<Map<string, string> | null>(null)
  const courseKey = (data ?? []).map(s => s.course_id).join(',')
  useEffect(() => {
    if (!courseKey) return
    let alive = true
    loadCourseExtras(courseKey.split(','))
      .then(ex => { if (alive) setShowcase(ex.showcase) })
      .catch(() => { /* остаётся название курса */ })
    return () => { alive = false }
  }, [courseKey])

  return (
    <div className="flex max-w-[760px] flex-col gap-5 pb-10 pt-2">
      <div>
        <span className="stu-kicker">Аккаунт</span>
        <h1 className="stu-h2">Моя подписка</h1>
      </div>
      {params.get('started') === 'trial' && (
        <p className="stu-note-ok">Пробный период начался — курс открыт.</p>
      )}
      {params.get('started') === 'promo' && (
        <p className="stu-note-ok" data-testid="my-subscription-promo-started">Промокод применён — курс открыт.</p>
      )}
      {isLoading && <p className="stu-muted">Загружаем…</p>}
      {error && <p className="text-[var(--redInk)]">Не удалось загрузить подписку. Обновите страницу.</p>}
      {!isLoading && !error && (data ?? []).length === 0 && (
        <div className="stu-card flex flex-col items-start gap-3 p-6">
          <p className="text-[17px] font-bold">Подписки пока нет.</p>
          <Link to="/courses" className="stu-btn stu-btn-p">Выбрать курс</Link>
        </div>
      )}
      {(data ?? []).map((s) => (
        <SubscriptionCard key={s.id} s={s} title={publicTitle(s.course_title, showcase?.get(s.course_id) ?? null)} />
      ))}
    </div>
  )
}
