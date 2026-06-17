/**
 * Страница, на которую ЮКасса редиректит после оплаты.
 * URL: /payment-result?payment_id=yk_...
 *
 * Статус платежа обновляется через вебхук асинхронно,
 * здесь просто показываем pending/success UI и предлагаем перейти в кабинет.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, XCircle, ArrowRight, GraduationCap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

type ResultState = 'loading' | 'succeeded' | 'pending' | 'cancelled' | 'error'

export function PaymentResultPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const paymentId = params.get('payment_id')   // YuKassa возвращает в return_url если настроен

  const [state, setState] = useState<ResultState>('loading')
  const [amount, setAmount] = useState<string>('')
  const [planName, setPlanName] = useState<string>('')

  useEffect(() => {
    if (!paymentId) {
      // Нет payment_id — просто показываем pending (вебхук сам обновит)
      setState('pending')
      return
    }

    // Опрашиваем нашу БД (вебхук мог уже прийти)
    let attempts = 0
    const poll = setInterval(async () => {
      attempts++
      const { data } = await (supabase as any)
        .from('payments')
        .select('status, amount, currency, plans(name)')
        .eq('yookassa_payment_id', paymentId)
        .maybeSingle()

      if (data) {
        setAmount(
          new Intl.NumberFormat('ru-RU', {
            style: 'currency', currency: data.currency || 'RUB', minimumFractionDigits: 0,
          }).format(data.amount)
        )
        setPlanName((data.plans as any)?.name || '')

        if (data.status === 'succeeded') {
          setState('succeeded')
          clearInterval(poll)
        } else if (data.status === 'cancelled') {
          setState('cancelled')
          clearInterval(poll)
        } else if (attempts >= 6) {
          // 6 попыток × 3 сек = 18 сек — если всё ещё pending, показываем pending UI
          setState('pending')
          clearInterval(poll)
        }
      } else if (attempts >= 3) {
        setState('pending')
        clearInterval(poll)
      }
    }, 3000)

    return () => clearInterval(poll)
  }, [paymentId])

  const configs: Record<ResultState, {
    icon:    React.ReactNode
    title:   string
    text:    string
    color:   string
    bg:      string
  }> = {
    loading: {
      icon:  <div className="w-12 h-12 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />,
      title: 'Проверяем платёж…',
      text:  'Это займёт несколько секунд',
      color: 'text-primary-600',
      bg:    'bg-primary-50',
    },
    succeeded: {
      icon:  <CheckCircle2 size={56} className="text-green-500" />,
      title: 'Оплата прошла успешно!',
      text:  `${amount ? amount + ' — ' : ''}подписка активирована. Добро пожаловать${planName ? ' в тариф «' + planName + '»' : ''}!`,
      color: 'text-green-700',
      bg:    'bg-green-50',
    },
    pending: {
      icon:  <Clock size={56} className="text-yellow-500" />,
      title: 'Платёж обрабатывается',
      text:  'Средства ещё не подтверждены. Мы уведомим вас, когда оплата пройдёт. Обычно это занимает до 5 минут.',
      color: 'text-yellow-700',
      bg:    'bg-yellow-50',
    },
    cancelled: {
      icon:  <XCircle size={56} className="text-red-500" />,
      title: 'Платёж отменён',
      text:  'Оплата не была завершена. Деньги не списывались. Попробуйте снова.',
      color: 'text-red-700',
      bg:    'bg-red-50',
    },
    error: {
      icon:  <XCircle size={56} className="text-red-500" />,
      title: 'Что-то пошло не так',
      text:  'Не удалось проверить статус платежа. Пожалуйста, обратитесь к администратору.',
      color: 'text-red-700',
      bg:    'bg-red-50',
    },
  }

  const cfg = configs[state]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">

      {/* Logo */}
      <button onClick={() => navigate('/')} className="flex items-center gap-2 font-bold text-gray-900 text-lg mb-12">
        <GraduationCap size={24} className="text-primary-600" />
        Школа Almiron
      </button>

      {/* Card */}
      <div className={cn('w-full max-w-md rounded-3xl border p-8 text-center space-y-5', cfg.bg, 'border-opacity-30')}>
        <div className="flex justify-center">{cfg.icon}</div>
        <h1 className={cn('text-2xl font-bold', cfg.color)}>{cfg.title}</h1>
        <p className="text-gray-600 leading-relaxed">{cfg.text}</p>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => navigate('/payments')}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
          >
            Перейти к платежам <ArrowRight size={16} />
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
          >
            В личный кабинет
          </button>
          {state === 'cancelled' && (
            <button
              onClick={() => navigate('/pricing')}
              className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              Попробовать снова
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
