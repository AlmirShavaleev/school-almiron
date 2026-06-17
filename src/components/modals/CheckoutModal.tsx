import { useState } from 'react'
import { X, CreditCard, Shield, RefreshCw, Check, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { createPayment } from '@/utils/createPayment'
import type { Plan } from '@/hooks/useSubscription'
import { cn } from '@/utils/cn'

const PERIOD_LABELS: Record<string, string> = {
  once:  'единоразово',
  month: 'в месяц',
  year:  'в год',
}

interface Props {
  open:      boolean
  onClose:   () => void
  plan:      Plan | null
  studentId: string | null
}

export function CheckoutModal({ open, onClose, plan, studentId }: Props) {
  const profile      = useAuthStore(s => s.profile)
  const [saveCard, setSaveCard]     = useState(true)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')

  async function handlePay() {
    if (!plan || !studentId || !profile) return
    setLoading(true)
    setError('')
    try {
      const result = await createPayment({
        plan_id:     plan.id,
        student_id:  studentId,
        profile_id:  profile.id,
        save_method: saveCard && plan.billing_period !== 'once',
      })
      setRedirectUrl(result.confirmation_url)
      // Auto-redirect after brief pause so user sees the redirect message
      setTimeout(() => { window.location.href = result.confirmation_url }, 1200)
    } catch (e: any) {
      setError(e.message || 'Ошибка создания платежа')
    } finally {
      setLoading(false)
    }
  }

  if (!open || !plan) return null

  const isRecurring = plan.billing_period !== 'once'
  const formattedPrice = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: plan.currency || 'RUB', minimumFractionDigits: 0,
  }).format(plan.price)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <CreditCard size={20} />
              </div>
              <div>
                <h2 className="font-bold text-lg">Оформление оплаты</h2>
                <p className="text-primary-200 text-sm">{plan.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Plan summary */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Тариф</span>
              <span className="font-semibold text-gray-900">{plan.name}</span>
            </div>
            {plan.description && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-gray-600">Описание</span>
                <span className="text-sm text-gray-700 text-right max-w-[200px]">{plan.description}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Период</span>
              <span className="font-medium text-gray-900 capitalize">
                {PERIOD_LABELS[plan.billing_period] || plan.billing_period}
              </span>
            </div>
            <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">К оплате</span>
              <span className="text-2xl font-bold text-primary-600">{formattedPrice}</span>
            </div>
          </div>

          {/* Features */}
          {plan.features.length > 0 && (
            <div className="space-y-1.5">
              {plan.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                  <Check size={14} className="text-green-500 shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          )}

          {/* Save card toggle (only for recurring) */}
          {isRecurring && (
            <label className="flex items-start gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 cursor-pointer hover:border-blue-200 transition-colors">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={saveCard}
                  onChange={e => setSaveCard(e.target.checked)}
                  className="sr-only"
                />
                <div className={cn(
                  'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                  saveCard ? 'bg-primary-600 border-primary-600' : 'bg-white border-gray-300'
                )}>
                  {saveCard && <Check size={12} className="text-white" />}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                  <RefreshCw size={13} className="text-blue-500" />
                  Автопродление
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Карта будет сохранена для автоматического списания {PERIOD_LABELS[plan.billing_period]}. Отменить можно в любой момент.
                </div>
              </div>
            </label>
          )}

          {/* Security note */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Shield size={13} className="shrink-0" />
            Оплата через ЮКассу — защищённое соединение, данные карты не передаются нам
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          {redirectUrl && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Перенаправляем на страницу оплаты…
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={loading || !!redirectUrl}>
              Отмена
            </Button>
            <Button className="flex-1" onClick={handlePay} loading={loading} disabled={!!redirectUrl}>
              {redirectUrl ? (
                <a href={redirectUrl} className="flex items-center gap-1">
                  Открыть оплату <ExternalLink size={13} />
                </a>
              ) : (
                <>
                  <CreditCard size={15} className="mr-1.5" />
                  Оплатить {formattedPrice}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
