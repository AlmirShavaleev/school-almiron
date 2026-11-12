import { useSearchParams, Link } from 'react-router-dom'
import { SiteAnalytics } from '@/components/admin/SiteAnalytics'
import { VideoStatsTab } from '@/components/admin/VideoStats'
import { useVercelAnalytics } from '@/hooks/useVercelAnalytics'
import { cn } from '@/utils/cn'

const tabs = [
  { key: 'site', label: 'Сайт' },
  { key: 'video', label: 'Видео' },
  { key: 'technical', label: 'Технический блок' },
] as const

function SitePanel() {
  const analytics = useVercelAnalytics()
  return <SiteAnalytics {...analytics} />
}

export function DiagnosticsPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('tab')
  const tab = tabs.some(t => t.key === selected) ? selected : 'site'
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Статистика и диагностика</h1>
        <p className="mt-1 text-sm text-gray-500">Посещения сайта, просмотры видео и работа сервисов школы.</p>
      </header>
      <nav aria-label="Разделы диагностики" className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setParams({ tab: t.key })}
            className={cn('min-h-11 rounded-lg px-4 py-2 text-sm font-medium', tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'site' && <SitePanel />}
      {tab === 'video' && <VideoStatsTab />}
      {tab === 'technical' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/admin/perf" className="rounded-2xl border border-gray-200 bg-white p-5 hover:border-primary-300">
            <h2 className="font-semibold text-gray-900">Скорость сайта →</h2>
            <p className="mt-2 text-sm text-gray-500">Время загрузки страниц и показатели производительности.</p>
          </Link>
          <Link to="/admin/telegram" className="rounded-2xl border border-gray-200 bg-white p-5 hover:border-primary-300">
            <h2 className="font-semibold text-gray-900">Журнал Telegram →</h2>
            <p className="mt-2 text-sm text-gray-500">История отправок, статусы доставки и ошибки уведомлений.</p>
          </Link>
        </div>
      )}
    </div>
  )
}
