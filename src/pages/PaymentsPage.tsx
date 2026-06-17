import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CreditCard, CheckCircle2, Clock, XCircle, RefreshCw,
  Zap, Calendar, AlertCircle, ArrowRight, Download,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { usePayments } from '@/hooks/usePayments'
import { useSubscription } from '@/hooks/useSubscription'
import { CheckoutModal } from '@/components/modals/CheckoutModal'
import { cn } from '@/utils/cn'
import { exportPayments } from '@/utils/exportExcel'

// ─── helpers ─────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  pending:             { label: 'Ожидается',  icon: <Clock size={12} />,        cls: 'bg-yellow-100 text-yellow-700' },
  waiting_for_capture: { label: 'Ожидается',  icon: <Clock size={12} />,        cls: 'bg-yellow-100 text-yellow-700' },
  succeeded:           { label: 'Оплачено',   icon: <CheckCircle2 size={12} />, cls: 'bg-green-100 text-green-700' },
  cancelled:           { label: 'Отменён',    icon: <XCircle size={12} />,      cls: 'bg-red-100 text-red-600' },
  refunded:            { label: 'Возврат',    icon: <RefreshCw size={12} />,    cls: 'bg-purple-100 text-purple-600' },
}

const SUB_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Активна',    cls: 'bg-green-100 text-green-700' },
  trial:     { label: 'Пробный',    cls: 'bg-blue-100 text-blue-700' },
  past_due:  { label: 'Просрочена', cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Отменена',   cls: 'bg-gray-100 text-gray-500' },
  expired:   { label: 'Истекла',    cls: 'bg-gray-100 text-gray-400' },
  pending:   { label: 'Ожидание',   cls: 'bg-yellow-100 text-yellow-700' },
}

const PERIOD_LABELS: Record<string, string> = {
  once:  'разово',
  month: 'ежемесячно',
  year:  'ежегодно',
}

function formatMoney(amount: number, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency, minimumFractionDigits: 0,
  }).format(amount)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function PaymentsPage() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  const isAdmin   = !!profile?.role && ['admin', 'owner'].includes(profile.role)
  const isStudent = profile?.role === 'student'

  const { payments, loading: paymentsLoading } = usePayments()
  const { subscription, studentId, loading: subLoading, cancelSubscription, reactivateSubscription } = useSubscription()
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [showCheckout, setShowCheckout]   = useState(false)

  const succeeded = payments.filter(p => p.status === 'succeeded')
  const totalPaid = succeeded.reduce((s, p) => s + p.amount, 0)
  const pendingAmt = payments.filter(p => ['pending', 'waiting_for_capture'].includes(p.status)).reduce((s, p) => s + p.amount, 0)

  function handleExport() {
    const rows = payments.map(p => ({
      date:        p.paid_at ? formatDate(p.paid_at) : formatDate(p.created_at),
      description: p.description || p.plans?.name || '—',
      student:     (p.students as any)?.profiles?.full_name || '—',
      amount:      p.amount,
      currency:    p.currency,
      status:      STATUS_CFG[p.status]?.label || p.status,
      recurring:   p.is_recurring ? 'Да' : 'Нет',
    }))
    exportPayments(rows)
  }

  return (
    <div className="space-y-7">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Платежи</h1>
          <p className="text-gray-500 mt-1">{isAdmin ? 'Все платежи школы' : 'Подписка и история оплат'}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isAdmin && !isStudent && null}
          {isStudent && !subLoading && !subscription && (
            <Button size="sm" onClick={() => navigate('/pricing')}>
              <Zap size={14} className="mr-1.5" />Купить подписку
            </Button>
          )}
          {payments.length > 0 && (
            <Button size="sm" variant="secondary" onClick={handleExport}>
              <Download size={14} className="mr-1.5" />Excel
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Оплачено"
          value={formatMoney(totalPaid)}
          icon={<CheckCircle2 size={20} />}
          color="green"
          subtitle={`${succeeded.length} платежей`}
        />
        <StatCard
          title="Ожидается"
          value={formatMoney(pendingAmt)}
          icon={<Clock size={20} />}
          color="orange"
        />
        <StatCard
          title="Всего платежей"
          value={payments.length}
          icon={<CreditCard size={20} />}
          color="blue"
        />
      </div>

      {/* ── Subscription card (student only) ───────────────────────────────── */}
      {isStudent && !subLoading && (
        <>
          {subscription ? (
            <Card className={cn(
              'border-2',
              subscription.status === 'active' ? 'border-green-200 bg-green-50/50' :
              subscription.status === 'past_due' ? 'border-red-200 bg-red-50/50' :
              'border-gray-200'
            )}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Zap size={16} className={subscription.status === 'active' ? 'text-green-600' : 'text-gray-400'} />
                  <CardTitle>Моя подписка</CardTitle>
                </div>
                <span className={cn(
                  'text-xs font-semibold px-2.5 py-1 rounded-full',
                  SUB_STATUS_CFG[subscription.status]?.cls
                )}>
                  {SUB_STATUS_CFG[subscription.status]?.label}
                </span>
              </CardHeader>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Тариф</div>
                  <div className="font-semibold text-gray-900">{subscription.plans?.name || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Стоимость</div>
                  <div className="font-semibold text-gray-900">
                    {subscription.plans ? formatMoney(subscription.plans.price) : '—'}
                    <span className="text-xs text-gray-400 ml-1">
                      {PERIOD_LABELS[subscription.plans?.billing_period || '']}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
                    <Calendar size={10} />Следующее списание
                  </div>
                  <div className="font-semibold text-gray-900">
                    {subscription.current_period_end ? formatDate(subscription.current_period_end) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Автопродление</div>
                  <div className={cn(
                    'font-semibold',
                    subscription.cancel_at_period_end ? 'text-orange-600' : 'text-green-600'
                  )}>
                    {subscription.cancel_at_period_end ? 'Будет отменена' : 'Включено'}
                  </div>
                </div>
              </div>

              {/* Cancel confirm */}
              {subscription.cancel_at_period_end ? (
                <div className="mt-4 flex items-center justify-between p-3 bg-orange-50 rounded-xl border border-orange-200">
                  <div className="flex items-center gap-2 text-sm text-orange-700">
                    <AlertCircle size={14} />
                    Подписка не продлится после {subscription.current_period_end ? formatDate(subscription.current_period_end) : '—'}
                  </div>
                  <Button size="sm" variant="secondary" onClick={reactivateSubscription}>
                    Возобновить
                  </Button>
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-xs text-gray-400">
                    {subscription.yookassa_payment_method_id ? '💳 Карта привязана' : 'Нет сохранённой карты'}
                  </div>
                  {!cancelConfirm ? (
                    <button
                      onClick={() => setCancelConfirm(true)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Отменить подписку
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600 font-medium">Точно отменить?</span>
                      <Button size="sm" variant="secondary" onClick={() => setCancelConfirm(false)}>Нет</Button>
                      <Button size="sm" onClick={async () => { await cancelSubscription(); setCancelConfirm(false) }} className="bg-red-600 hover:bg-red-700">
                        Да, отменить
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ) : (
            <Card className="border-dashed border-2 border-gray-200">
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="font-semibold text-gray-800">Нет активной подписки</div>
                  <div className="text-sm text-gray-400 mt-0.5">Выберите тариф для доступа ко всем материалам</div>
                </div>
                <Button onClick={() => navigate('/pricing')}>
                  Выбрать тариф <ArrowRight size={14} className="ml-1" />
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Payment history ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>История платежей</CardTitle>
          <Badge variant="default">{payments.length}</Badge>
        </CardHeader>

        {paymentsLoading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Загрузка…</div>
        ) : payments.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <CreditCard size={36} className="mx-auto opacity-20 mb-3" />
            <p>Платежей пока нет</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left py-3 pl-2 font-medium">Дата</th>
                  {isAdmin && <th className="text-left py-3 font-medium">Ученик</th>}
                  <th className="text-left py-3 font-medium">Описание</th>
                  <th className="text-left py-3 font-medium">Сумма</th>
                  <th className="text-left py-3 font-medium">Тип</th>
                  <th className="text-left py-3 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payments.map(p => {
                  const cfg   = STATUS_CFG[p.status] || STATUS_CFG['pending']
                  const date  = p.paid_at || p.created_at
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pl-2 text-gray-500 whitespace-nowrap">
                        {new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      {isAdmin && (
                        <td className="py-3 text-gray-700">
                          {(p.students as any)?.profiles?.full_name || '—'}
                        </td>
                      )}
                      <td className="py-3 text-gray-800 max-w-xs">
                        <div className="truncate">{p.description || p.plans?.name || '—'}</div>
                        {p.is_recurring && (
                          <span className="text-xs text-blue-500 flex items-center gap-0.5 mt-0.5">
                            <RefreshCw size={10} />авто
                          </span>
                        )}
                      </td>
                      <td className="py-3 font-semibold text-gray-900 whitespace-nowrap">
                        {formatMoney(p.amount, p.currency)}
                      </td>
                      <td className="py-3 text-gray-400 text-xs">
                        {PERIOD_LABELS[p.plans?.billing_period || ''] || '—'}
                      </td>
                      <td className="py-3">
                        <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full', cfg.cls)}>
                          {cfg.icon}{cfg.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CheckoutModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        plan={null}
        studentId={studentId}
      />
    </div>
  )
}
