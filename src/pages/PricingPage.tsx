import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Zap, Star, Shield, ChevronRight, GraduationCap, RefreshCw } from 'lucide-react'
import { usePlans, useSubscription, type Plan } from '@/hooks/useSubscription'
import { CheckoutModal } from '@/components/modals/CheckoutModal'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/utils/cn'

const PERIOD_LABELS: Record<string, string> = {
  once:  'единоразово',
  month: '/ месяц',
  year:  '/ год',
}

const PERIOD_BADGE: Record<string, { label: string; cls: string }> = {
  month: { label: 'Ежемесячно', cls: 'bg-blue-100 text-blue-700' },
  year:  { label: 'Ежегодно',   cls: 'bg-green-100 text-green-700' },
  once:  { label: 'Разово',     cls: 'bg-gray-100 text-gray-600' },
}

function PlanCard({
  plan,
  isPopular,
  isOwned,
  onBuy,
}: {
  plan:      Plan
  isPopular: boolean
  isOwned:   boolean
  onBuy:     (plan: Plan) => void
}) {
  const formattedPrice = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: plan.currency || 'RUB', minimumFractionDigits: 0,
  }).format(plan.price)

  const badge = PERIOD_BADGE[plan.billing_period]

  return (
    <div className={cn(
      'relative flex flex-col rounded-3xl border-2 p-7 transition-all',
      isPopular
        ? 'border-primary-500 bg-primary-600 text-white shadow-2xl shadow-primary-200 scale-105'
        : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-lg'
    )}>
      {isPopular && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-xs font-bold px-4 py-1.5 rounded-full flex items-center gap-1 shadow-md">
          <Star size={11} /> Популярный
        </div>
      )}

      {/* Period badge */}
      <div className="mb-4">
        <span className={cn(
          'text-xs font-semibold px-2.5 py-1 rounded-full',
          isPopular ? 'bg-white/20 text-white' : badge.cls
        )}>
          {badge.label}
        </span>
      </div>

      {/* Name & price */}
      <h3 className={cn('text-xl font-bold mb-1', isPopular ? 'text-white' : 'text-gray-900')}>
        {plan.name}
      </h3>
      {plan.description && (
        <p className={cn('text-sm mb-4', isPopular ? 'text-primary-100' : 'text-gray-500')}>
          {plan.description}
        </p>
      )}

      <div className="mb-6">
        <span className={cn('text-4xl font-extrabold', isPopular ? 'text-white' : 'text-gray-900')}>
          {formattedPrice}
        </span>
        <span className={cn('text-sm ml-1', isPopular ? 'text-primary-200' : 'text-gray-400')}>
          {PERIOD_LABELS[plan.billing_period]}
        </span>
      </div>

      {/* Features */}
      <ul className="space-y-2.5 flex-1 mb-7">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <div className={cn(
              'w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5',
              isPopular ? 'bg-white/25' : 'bg-primary-100'
            )}>
              <Check size={10} className={isPopular ? 'text-white' : 'text-primary-600'} />
            </div>
            <span className={isPopular ? 'text-primary-100' : 'text-gray-600'}>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isOwned ? (
        <div className={cn(
          'w-full py-3 rounded-xl text-sm font-semibold text-center',
          isPopular ? 'bg-white/20 text-white' : 'bg-green-100 text-green-700'
        )}>
          ✓ Активна
        </div>
      ) : (
        <button
          onClick={() => onBuy(plan)}
          className={cn(
            'w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
            isPopular
              ? 'bg-white text-primary-700 hover:bg-primary-50'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          )}
        >
          Выбрать тариф <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}

export function PricingPage() {
  const navigate  = useNavigate()
  const profile   = useAuthStore(s => s.profile)
  const { plans, loading: plansLoading } = usePlans()
  const { subscription, studentId }      = useSubscription()

  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [showCheckout, setShowCheckout] = useState(false)

  function handleBuy(plan: Plan) {
    if (!profile) {
      // Не залогинен → на логин с return
      navigate('/login?returnTo=/pricing')
      return
    }
    if (profile.role !== 'student') {
      alert('Оформить подписку может только ученик.')
      return
    }
    setSelectedPlan(plan)
    setShowCheckout(true)
  }

  const activePlanId = subscription?.status === 'active' ? subscription.plan_id : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-6xl mx-auto">
        <button onClick={() => navigate('/')} className="flex items-center gap-2 font-bold text-gray-900 text-lg">
          <GraduationCap size={24} className="text-primary-600" />
          Школа Almiron
        </button>
        <div className="flex items-center gap-3">
          {profile ? (
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              В кабинет
            </button>
          ) : (
            <>
              <button onClick={() => navigate('/login')} className="text-sm text-gray-600 hover:text-gray-900 font-medium">
                Войти
              </button>
              <button
                onClick={() => navigate('/register')}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
              >
                Регистрация
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center px-6 py-16 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-sm font-medium px-4 py-2 rounded-full mb-6">
          <Zap size={14} />
          Онлайн-подготовка к ЕГЭ и ОГЭ
        </div>
        <h1 className="text-4xl lg:text-5xl font-extrabold text-gray-900 leading-tight mb-5">
          Выберите тариф<br />
          <span className="text-primary-600">и начните учиться</span>
        </h1>
        <p className="text-lg text-gray-500 leading-relaxed">
          Все тарифы включают личный кабинет, домашние задания с проверкой,
          расписание и статистику прогресса.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        {plansLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">Тарифы скоро появятся</p>
            <p className="text-sm mt-1">Свяжитесь с нами для получения информации</p>
          </div>
        ) : (
          <div className={cn(
            'grid gap-6',
            plans.length === 1 ? 'max-w-sm mx-auto' :
            plans.length === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-2xl mx-auto' :
            'grid-cols-1 md:grid-cols-3'
          )}>
            {plans.map((plan, i) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isPopular={plans.length >= 3 && i === Math.floor(plans.length / 2)}
                isOwned={activePlanId === plan.id}
                onBuy={handleBuy}
              />
            ))}
          </div>
        )}
      </section>

      {/* Trust block */}
      <section className="border-t border-gray-100 bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[
              { icon: <Shield size={28} className="text-primary-500" />, title: 'Безопасная оплата', text: 'Платежи через ЮКассу. Данные карты надёжно защищены.' },
              { icon: <RefreshCw size={28} className="text-green-500" />, title: 'Лёгкая отмена', text: 'Автопродление можно отключить в любой момент в личном кабинете.' },
              { icon: <Star size={28} className="text-yellow-500" />, title: 'Гарантия качества', text: 'Если в первые 7 дней что-то пойдёт не так — вернём деньги.' },
            ].map((item, i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                {item.icon}
                <div className="font-semibold text-gray-900">{item.title}</div>
                <div className="text-sm text-gray-500">{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Checkout modal */}
      <CheckoutModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        plan={selectedPlan}
        studentId={studentId}
      />
    </div>
  )
}

