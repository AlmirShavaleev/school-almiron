import { RefreshCw, Globe, Monitor, Link2, FileText } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { SiteAnalyticsData, SiteBreakdown } from '@/hooks/useVercelAnalytics'

/**
 * Вкладка «Сайт» — посещения по данным Vercel Web Analytics.
 *
 * Отдельной вкладкой, а не блоком в «Обзоре», намеренно: рядом живут школьные
 * срезы §107, и «сколько заходов» там и здесь — разные числа из разных
 * источников. На одном экране их спутают гарантированно.
 */

interface SiteAnalyticsProps extends SiteAnalyticsData {
  loading: boolean
  error:   string | null
  reload:  () => void
}

export function SiteAnalytics(props: SiteAnalyticsProps) {
  const {
    totals7, totals30, days, sections, referrers, devices, countries,
    fetchedAt, fromCache, throttled, partial, daysReturned,
    loading, error, reload,
  } = props

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        Загружаем статистику сайта…
      </div>
    )
  }

  if (error) {
    // «Не включено» и «токен не подошёл» приходят словами из функции. Нули
    // здесь показывать нельзя: они читаются как «никто не заходил».
    return (
      <div
        data-testid="site-analytics-error"
        role="alert"
        className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
      >
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="site-analytics">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">
            Посещения сайта по данным Vercel. Учебная активность — на вкладке «Обзор».
          </p>
          <p className="mt-1 text-xs text-slate-400" data-testid="site-analytics-freshness">
            {fetchedAt ? `Данные на ${formatTime(fetchedAt)}` : 'Время получения неизвестно'}
            {fromCache && ' · из кэша'}
            {daysReturned > 0 && ` · история за ${daysReturned} дн.`}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-slate-500 transition-colors hover:text-graphite-900"
        >
          <RefreshCw size={14} />Обновить
        </button>
      </header>

      {throttled && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Обновляли только что — показаны прежние данные. Vercel опрашивается не чаще раза в минуту.
        </p>
      )}
      {partial && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Часть запросов к Vercel не прошла — числа ниже неполные.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat title="Посетителей за 7 дней" value={totals7.visitors} />
        <Stat title="Просмотров за 7 дней"  value={totals7.pageviews} />
        <Stat title="Посетителей за 30 дней" value={totals30.visitors} />
        <Stat title="Просмотров за 30 дней"  value={totals30.pageviews} />
      </div>

      <DaysChart days={days} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionsBlock sections={sections} />
        <ListBlock title="Источники переходов" icon={<Link2 size={16} />} rows={referrers} />
        <ListBlock title="Устройства" icon={<Monitor size={16} />} rows={devices} />
        <ListBlock title="Страны" icon={<Globe size={16} />} rows={countries} />
      </div>
    </div>
  )
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-graphite-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{title}</div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">{children}</div>
}

function Head({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-sm font-semibold text-graphite-950">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function DaysChart({ days }: { days: SiteAnalyticsData['days'] }) {
  const max = days.reduce((m, d) => Math.max(m, d.pageviews), 0)

  return (
    <Shell>
      <Head icon={<FileText size={16} />} title="Просмотры по дням" hint="За последние 30 дней" />
      {days.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Vercel не вернул разбивку по дням.</p>
      ) : max === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">За период просмотров не было.</p>
      ) : (
        // Дни без просмотров рисуются нулевой полоской, а не пропускаются:
        // иначе провал выглядел бы как отсутствие данных.
        <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Просмотры по дням">
          {days.map(d => (
            <div
              key={d.day}
              title={`${formatDay(d.day)} — ${d.pageviews}`}
              className={cn('flex-1 rounded-t-sm', d.pageviews > 0 ? 'bg-primary-500' : 'bg-slate-100')}
              style={{ height: `${d.pageviews > 0 ? Math.max((d.pageviews / max) * 100, 8) : 3}%` }}
            />
          ))}
        </div>
      )}
    </Shell>
  )
}

function SectionsBlock({ sections }: { sections: SiteAnalyticsData['sections'] }) {
  const max = sections.reduce((m, s) => Math.max(m, s.pageviews), 0)

  return (
    <Shell>
      <Head
        icon={<FileText size={16} />}
        title="Разделы сайта"
        hint="Пути свёрнуты по первому сегменту: Vercel знает шаблоны маршрутов только для Next.js"
      />
      {sections.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Просмотров пока нет.</p>
      ) : (
        <ul className="space-y-2">
          {sections.map(s => (
            <li key={s.section} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-graphite-900">{s.section}</span>
              <span className="h-1.5 flex-1 rounded-full bg-slate-100">
                <span
                  className="block h-1.5 rounded-full bg-primary-500"
                  style={{ width: `${max > 0 ? Math.round((s.pageviews / max) * 100) : 0}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-sm text-slate-500">{s.pageviews}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function ListBlock({
  title, icon, rows,
}: {
  title: string
  icon: React.ReactNode
  rows: SiteBreakdown[]
}) {
  return (
    <Shell>
      <Head icon={icon} title={title} />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Данных нет.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {rows.map(row => (
            <li key={row.label} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-graphite-900">{row.label}</span>
              <span className="shrink-0 text-sm text-slate-500">
                {row.visitors} чел. · {row.pageviews} просм.
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
