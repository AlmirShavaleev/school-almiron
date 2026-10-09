/**
 * §282. Витрина подписки (публичная, `/subscribe`). Тарифы — из
 * `subscription_tariffs_public()`: при выключенном флаге там пусто, и экран
 * говорит «пока недоступно». Гостя ведём на регистрацию, запомнив тариф
 * (`pendingSubscribe`): после входа он вернётся к оформлению.
 */
import { Link, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SchoolMark } from '@/components/brand/SchoolMark'
import { useAuthStore } from '@/store/authStore'
import { usePublicTariffs } from '@/hooks/useSubscription'
import { savePendingSubscribe } from '@/lib/subscription/pendingSubscribe'
import { daysLabel, formatRub, periodLabel, type PublicTariff } from '@/lib/subscription/view'

export function SubscribePage() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { data: tariffs, isLoading, error } = usePublicTariffs()

  function choose(t: PublicTariff) {
    if (profile?.role === 'student') {
      navigate(`/subscribe/checkout/${t.id}`)
      return
    }
    savePendingSubscribe(t.id)
    navigate('/register')
  }

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-card">
            <SchoolMark size={38} />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold leading-tight text-graphite-900">Подписка на курс</h1>
            <p className="text-[15px] text-graphite-500">Школа Almiron · подготовка к ЕГЭ</p>
          </div>
        </header>

        {isLoading && <p className="text-graphite-500">Загружаем тарифы…</p>}
        {error && <p className="text-red-700">Не удалось загрузить тарифы. Обновите страницу.</p>}
        {!isLoading && !error && (tariffs ?? []).length === 0 && (
          <div className="platform-surface rounded-card p-6" data-testid="subscribe-unavailable">
            <p className="text-[17px] text-graphite-900">Оформление подписки пока недоступно.</p>
            <p className="mt-1 text-[15px] text-graphite-500">Если вам дали ссылку или код курса — вступите по ним.</p>
            <Link to="/join" className="mt-4 inline-block text-primary-600 underline">Вступить по коду</Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {(tariffs ?? []).map((t) => (
            <article key={t.id} className="platform-surface flex flex-col rounded-card p-6" data-testid="tariff-card">
              <p className="text-xs font-medium uppercase tracking-[.03em] text-graphite-500">{t.course_title}</p>
              <h2 className="mt-1 text-[20px] font-semibold text-graphite-900">{t.title}</h2>
              <p className="mt-3 text-[28px] font-semibold text-graphite-900">
                {formatRub(t.price_rub)} <span className="text-[15px] font-normal text-graphite-500">{periodLabel(t.period_months)}</span>
              </p>
              {t.description && <p className="mt-2 whitespace-pre-line text-[15px] text-graphite-700">{t.description}</p>}
              <ul className="mt-3 space-y-1 text-[15px] text-graphite-700">
                {t.trial_days > 0 && (
                  <li className="flex items-center gap-2"><Check size={16} className="text-verdict-ok" />Пробный период — {daysLabel(t.trial_days)}, без карты</li>
                )}
                <li className="flex items-center gap-2"><Check size={16} className="text-verdict-ok" />Отмена автопродления в любой момент</li>
                <li className="flex items-center gap-2"><Check size={16} className="text-verdict-ok" />Прогресс сохраняется, даже если сделать перерыв</li>
              </ul>
              <div className="mt-auto pt-5">
                <Button
                  className="w-full"
                  onClick={() => choose(t)}
                  disabled={!!profile && profile.role !== 'student'}
                  data-testid="tariff-choose"
                >
                  {t.trial_days > 0 ? 'Попробовать' : 'Оформить'}
                </Button>
              </div>
            </article>
          ))}
        </div>

        {!profile && (tariffs ?? []).length > 0 && (
          <p className="mt-6 text-[15px] text-graphite-500">
            Уже есть аккаунт? <Link to="/login" className="text-primary-600 underline">Войти</Link>
          </p>
        )}
        {profile && profile.role !== 'student' && (tariffs ?? []).length > 0 && (
          <p className="mt-6 text-[15px] text-graphite-500">Подписку оформляет учётная запись ученика.</p>
        )}
      </div>
    </div>
  )
}
