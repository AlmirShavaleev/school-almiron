import { useSearchParams } from 'react-router-dom'
import { FinancePage } from './FinancePage'
import { SubscriptionAdminPanel } from './SubscriptionsAdminPage'

const TABS = [
  ['overview', 'Обзор'], ['subs', 'Подписчики'], ['payments', 'История платежей'],
  ['tariffs', 'Тарифы'], ['settings', 'Настройки'],
] as const
const EXTRA = [['settings', 'Общие настройки'], ['promo', 'Промокоды'], ['log', 'Технический журнал']] as const
const valid = new Set(['overview', 'subs', 'payments', 'tariffs', 'settings', 'promo', 'log'])

export function BillingPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') ?? 'overview'
  const tab = valid.has(raw) ? raw : 'overview'
  const active = tab === 'promo' || tab === 'log' ? 'settings' : tab
  function select(key: string) {
    setParams(prev => { const next = new URLSearchParams(prev); next.set('tab', key); if (key !== 'subs') next.delete('search'); return next })
  }
  return <div className="mx-auto w-full min-w-0 max-w-[1250px] space-y-6 pb-10">
    <header><h1 className="text-3xl font-extrabold text-graphite-950">Финансы и подписки</h1><p className="mt-2 text-sm text-graphite-500">Поступления, доступ учеников и тарифы — в одном разделе.</p></header>
    <nav aria-label="Финансы и подписки" className="flex flex-wrap gap-2">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={active === key} onClick={() => select(key)} className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${active === key ? 'bg-primary-600 text-white' : 'border border-graphite-200 bg-white text-graphite-600 hover:bg-primary-50'}`}>{label}</button>)}
    </nav>
    {tab === 'overview' ? <FinancePage embedded /> : <section className="min-w-0 rounded-[24px] border border-graphite-200 bg-white p-4 sm:p-6" aria-label={TABS.find(([key]) => key === active)?.[1]}>
      {active === 'settings' && <nav aria-label="Настройки подписок" className="mb-6 flex flex-wrap gap-2">{EXTRA.map(([key, label]) => <button type="button" key={key} onClick={() => select(key)} aria-pressed={tab === key} className={`min-h-10 rounded-xl border px-3 text-sm ${tab === key ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-graphite-200'}`}>{label}</button>)}</nav>}
      <SubscriptionAdminPanel search={params.get('search') ?? ''} tab={tab as 'subs' | 'payments' | 'tariffs' | 'settings' | 'promo' | 'log'} />
    </section>}
  </div>
}
