/**
 * §282. Оформление подписки (`/subscribe/checkout/:tariffId`, ученик).
 *
 * Email для чека, согласие с офертой и политикой, «мне нет 18» → согласие
 * родителя, «сохранить карту для автопродления» (по умолчанию выключено).
 * Тексты оферты/политики — по ссылкам из `subscription_settings`; их пишет
 * не агент. Главное действие одно: пробный период, если он доступен, иначе
 * оплата. Те же правила проверяет SQL — форма лишь подсказывает раньше.
 *
 * §287. Промокод: «Применить» спрашивает сервер (`subscription_promo_check`),
 * экран только показывает ответ — цену не считает. В оформление уходит лишь
 * применённый код; бесплатный исход (дни, месяцы, скидка 100 %) — без
 * страницы ЮKassa, сразу в «Мою подписку».
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuthStore } from '@/store/authStore'
import { useMySubscriptions, usePublicTariffs, useSubscriptionSettings } from '@/hooks/useSubscription'
import { beginCheckout, checkPromo, startTrial, SubscriptionError } from '@/lib/subscription/api'
import { clearPendingSubscribe } from '@/lib/subscription/pendingSubscribe'
import {
  checkoutErrorText,
  checkoutErrors,
  daysLabel,
  formatDateMsk,
  formatRub,
  periodLabel,
  promoSummary,
  type CheckoutForm,
  type PromoPreview,
} from '@/lib/subscription/view'

type AppliedPromo = Extract<PromoPreview, { ok: true }>

function Check({ checked, onChange, children, error, testId }: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
  error?: string
  testId: string
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-[15px] text-graphite-900">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-primary-600"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={testId}
        />
        <span>{children}</span>
      </label>
      {error && <p className="ml-8 mt-1 text-[13px] text-verdict-bad-ink">✕ {error}</p>}
    </div>
  )
}

function DocLink({ href, children }: { href: string | null | undefined; children: React.ReactNode }) {
  if (!href) return <span className="underline decoration-dotted" title="Текст появится позже">{children}</span>
  return <a href={href} target="_blank" rel="noreferrer" className="text-primary-600 underline">{children}</a>
}

export function SubscriptionCheckoutPage() {
  const { tariffId } = useParams<{ tariffId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const tariffs = usePublicTariffs()
  const settings = useSubscriptionSettings()
  const mine = useMySubscriptions()
  const tariff = useMemo(() => (tariffs.data ?? []).find((t) => t.id === tariffId) ?? null, [tariffs.data, tariffId])
  const existing = useMemo(
    () => (mine.data ?? []).find((s) => tariff && s.course_id === tariff.course_id) ?? null,
    [mine.data, tariff],
  )
  const [promoInput, setPromoInput] = useState('')
  const [promo, setPromo] = useState<AppliedPromo | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoBusy, setPromoBusy] = useState(false)
  const trialAvailable = !!tariff && tariff.trial_days > 0 && (!existing || existing.status === 'pending') && !promo

  const [form, setForm] = useState<CheckoutForm>({
    email: profile?.email ?? '',
    acceptedOffer: false,
    isMinor: false,
    parentConsent: false,
    saveCard: false,
  })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState<'pay' | 'trial' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errors = touched ? checkoutErrors(form) : {}
  const set = <K extends keyof CheckoutForm>(k: K, v: CheckoutForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (tariffs.isLoading || mine.isLoading) return <p className="p-6 text-graphite-500">Загружаем…</p>
  if (!tariff) {
    return (
      <div className="p-6">
        <p className="text-[17px] text-graphite-900">Тариф недоступен.</p>
        <Link to="/subscribe" className="mt-2 inline-block text-primary-600 underline">К тарифам</Link>
      </div>
    )
  }

  async function applyPromo() {
    const code = promoInput.trim()
    setPromoError(null)
    setPromo(null)
    if (!code) return
    setPromoBusy(true)
    try {
      const r = await checkPromo(tariff!.id, code)
      if (r.ok) setPromo(r)
      else setPromoError(checkoutErrorText(r.error_code, r.error))
    } catch (e) {
      setPromoError(checkoutErrorText(e instanceof SubscriptionError ? e.code : null, e instanceof Error ? e.message : null))
    } finally {
      setPromoBusy(false)
    }
  }

  async function run(kind: 'pay' | 'trial') {
    setTouched(true)
    setError(null)
    if (Object.keys(checkoutErrors(form)).length > 0) return
    setBusy(kind)
    try {
      if (kind === 'trial') {
        await startTrial(tariff!.id, form)
        clearPendingSubscribe()
        await mine.refetch()
        navigate('/my-subscription?started=trial')
      } else {
        const res = await beginCheckout(tariff!.id, form, promo?.code ?? null)
        clearPendingSubscribe()
        if (res.free) {
          await mine.refetch()
          navigate('/my-subscription?started=promo')
        } else {
          window.location.assign(res.confirmation_url)
        }
      }
    } catch (e) {
      const code = e instanceof SubscriptionError ? e.code : null
      if (code === 'PROMO_INVALID' || code === 'RATE_LIMIT' || code === 'PROMO_ACTIVE' || code === 'PROMO_BUSY') setPromo(null)
      setError(checkoutErrorText(code, e instanceof Error ? e.message : null))
      setBusy(null)
    }
  }

  // скидка по уже применённому коду (N платежей подряд) — сумму назвал сервер
  const continuing = !promo && existing?.promo && existing.tariff_id === tariff.id ? existing.promo : null
  const payAmount = promo ? promo.amount_rub : continuing ? continuing.next_amount_rub : tariff.price_rub
  const promoFree = !!promo && (promo.free || promo.kind !== 'percent')

  const s = settings.data
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6" data-testid="subscription-checkout">
      <h1 className="text-[28px] font-semibold text-graphite-900">Оформление подписки</h1>
      <p className="mt-1 text-[17px] text-graphite-700">
        {tariff.course_title} · {tariff.title} — {formatRub(tariff.price_rub)} {periodLabel(tariff.period_months)}
      </p>
      {existing && existing.has_access && (
        <p className="mt-2 text-[15px] text-graphite-500">
          Курс уже открыт до {formatDateMsk(existing.access_until)}. Новый период начнётся с этой даты.
        </p>
      )}

      <div className="platform-surface mt-6 space-y-5 rounded-card p-5 sm:p-6">
        <Input
          label="Email для чека"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          data-testid="checkout-email"
        />
        <Check checked={form.acceptedOffer} onChange={(v) => set('acceptedOffer', v)} error={errors.acceptedOffer} testId="checkout-offer">
          Принимаю <DocLink href={s?.offer_url}>условия оферты</DocLink> и <DocLink href={s?.privacy_url}>политику обработки персональных данных</DocLink>
        </Check>
        <Check checked={form.isMinor} onChange={(v) => set('isMinor', v)} testId="checkout-minor">
          Мне ещё нет 18 лет
        </Check>
        {form.isMinor && (
          <Check checked={form.parentConsent} onChange={(v) => set('parentConsent', v)} error={errors.parentConsent} testId="checkout-parent">
            Родитель (законный представитель) знает об оплате и <DocLink href={s?.parent_consent_url}>согласен</DocLink>
          </Check>
        )}
        <Check checked={form.saveCard} onChange={(v) => set('saveCard', v)} testId="checkout-save-card">
          Сохранить карту и продлевать подписку автоматически каждый месяц. Отключить можно в любой момент в разделе «Моя подписка».
        </Check>
      </div>

      <div className="platform-surface mt-4 rounded-card p-5 sm:p-6">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Input
              label="Промокод"
              value={promoInput}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => {
                setPromoInput(e.target.value)
                if (promo) setPromo(null)
                setPromoError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void applyPromo() }
              }}
              data-testid="checkout-promo"
            />
          </div>
          <Button variant="secondary" onClick={applyPromo} loading={promoBusy} disabled={!promoInput.trim() || busy != null}
            data-testid="checkout-promo-apply">
            Применить
          </Button>
        </div>
        {promo && <p className="mt-2 text-[15px] text-verdict-ok-ink" data-testid="checkout-promo-ok">✓ {promoSummary(promo)}</p>}
        {promoError && <p className="mt-2 text-[15px] text-verdict-bad-ink" data-testid="checkout-promo-error">✕ {promoError}</p>}
      </div>

      {error && <p className="mt-4 rounded-lg bg-verdict-bad-tint px-4 py-3 text-[15px] text-verdict-bad-ink" data-testid="checkout-error">{error}</p>}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {trialAvailable ? (
          <>
            <Button onClick={() => run('trial')} loading={busy === 'trial'} disabled={busy != null} data-testid="checkout-trial">
              Начать пробный период — {daysLabel(tariff.trial_days)}
            </Button>
            <Button variant="secondary" onClick={() => run('pay')} loading={busy === 'pay'} disabled={busy != null} data-testid="checkout-pay">
              Сразу оплатить {formatRub(tariff.price_rub)}
            </Button>
          </>
        ) : promoFree ? (
          <Button onClick={() => run('pay')} loading={busy === 'pay'} disabled={busy != null} data-testid="checkout-pay">
            Активировать по промокоду
          </Button>
        ) : (
          <Button onClick={() => run('pay')} loading={busy === 'pay'} disabled={busy != null} data-testid="checkout-pay">
            Перейти к оплате {formatRub(payAmount)}
          </Button>
        )}
      </div>
      {!promoFree && (
        <p className="mt-3 text-[13px] text-graphite-500">Оплата — на защищённой странице ЮKassa. Данные карты к нам не попадают.</p>
      )}
    </div>
  )
}
