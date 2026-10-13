/**
 * §291. Админка → «Скорость»: сколько ученик ждёт вкладки и какие запросы к
 * базе медленные — за час / сегодня / 7 дней; по часам; по ученику.
 * Данные — свой RUM (`perf_events`), права — в SQL (admin_perf_* → ONLY_ADMIN).
 *
 * Графики — по одному показателю на график (одна ось): p95 вкладки по часам
 * и отдельно «учеников в час» (пик нагрузки). Подсказка — при наведении.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  fetchPerfHourly,
  fetchPerfPeople,
  fetchPerfRecent,
  fetchPerfSummary,
  formatMs,
  type PerfHour,
  type PerfPeriod,
  type PerfRow,
} from '@/lib/perf/perfAdmin'

const PERIODS: Array<{ key: PerfPeriod; label: string }> = [
  { key: 'hour', label: 'Час' },
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
]

function hourLabel(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit' })
}

/** Столбики по часам: один показатель, одна ось, подсказка на наведение. */
function HourBars({ points, value, format, title, testId }: {
  points: PerfHour[]
  value: (h: PerfHour) => number
  format: (v: number) => string
  title: string
  testId: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map(value))
  const W = 640, H = 120, gap = 2
  const bw = points.length ? Math.max(2, (W - gap * (points.length - 1)) / points.length) : 0
  const h = hover != null ? points[hover] : null
  return (
    <figure className="space-y-1" data-testid={testId}>
      <figcaption className="flex items-baseline justify-between text-[13px] text-graphite-700">
        <span className="font-semibold">{title}</span>
        <span className="text-graphite-500">
          {h ? `${hourLabel(h.hour)} · ${format(value(h))}` : `макс. ${format(max)}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label={title} preserveAspectRatio="none">
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} className="stroke-graphite-200" strokeWidth="1" />
        {points.map((p, i) => {
          const bh = Math.max(1, (value(p) / max) * (H - 4))
          return (
            <g key={p.hour} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* цель наведения — на всю высоту, больше самого столбика */}
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={Math.min(4, bw / 2)}
                className={cn('fill-primary-500', hover === i && 'fill-primary-700')}>
                <title>{`${hourLabel(p.hour)}: ${format(value(p))}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

function SummaryTable({ rows, selected, onSelect, testId }: {
  rows: PerfRow[]
  selected?: string | null
  onSelect?: (label: string) => void
  testId: string
}) {
  if (rows.length === 0) return <p className="text-[13px] text-graphite-500">Событий за период нет.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" data-testid={testId}>
        <thead className="text-left text-graphite-500">
          <tr>
            <th className="py-1 pr-3">Что</th>
            <th className="pr-3 text-right">p50</th>
            <th className="pr-3 text-right">p95</th>
            <th className="pr-3 text-right">макс.</th>
            <th className="pr-3 text-right">раз</th>
            <th className="pr-3 text-right">учеников</th>
            <th className="text-right">ошибок</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} data-testid={`${testId}-row`}
              className={cn('border-t border-graphite-200', onSelect && 'cursor-pointer hover:bg-graphite-50', selected === r.label && 'bg-primary-50')}
              onClick={() => onSelect?.(r.label)}>
              <td className="py-1 pr-3 font-mono">{r.label}</td>
              <td className="pr-3 text-right">{formatMs(r.p50)}</td>
              <td className={cn('pr-3 text-right font-semibold', r.p95 >= 3000 ? 'text-verdict-bad-ink' : 'text-graphite-900')}>{formatMs(r.p95)}</td>
              <td className="pr-3 text-right">{formatMs(r.max)}</td>
              <td className="pr-3 text-right">{r.n}</td>
              <td className="pr-3 text-right">{r.students}</td>
              <td className="text-right">{r.errors || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PerfAdminPage() {
  const [period, setPeriod] = useState<PerfPeriod>('today')
  const [route, setRoute] = useState<string | null>(null)
  const [person, setPerson] = useState<string>('')

  const routes = useQuery({ queryKey: ['perf', 'route', period, person], queryFn: () => fetchPerfSummary('route', period, person || null) })
  const apis = useQuery({ queryKey: ['perf', 'api', period, person], queryFn: () => fetchPerfSummary('api', period, person || null) })
  const people = useQuery({ queryKey: ['perf', 'people', period], queryFn: () => fetchPerfPeople(period) })
  const activeRoute = route ?? routes.data?.[0]?.label ?? null
  const hourly = useQuery({
    queryKey: ['perf', 'hourly', activeRoute, period],
    queryFn: () => fetchPerfHourly('route', activeRoute!, period),
    enabled: !!activeRoute,
  })
  const recent = useQuery({ queryKey: ['perf', 'recent', person], queryFn: () => fetchPerfRecent(person), enabled: !!person })

  const err = routes.error ?? apis.error ?? people.error
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold text-graphite-900">Скорость</h1>
          <p className="text-[13px] text-graphite-500">Сколько ученики ждут вкладки и запросы к базе (p95 — 95 % быстрее этого).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} aria-pressed={period === p.key}
              data-testid={`perf-period-${p.key}`}
              className={cn('rounded-full px-4 py-2 text-[15px]', period === p.key ? 'bg-gold-300 font-semibold text-graphite-900' : 'bg-white text-graphite-700 hover:bg-graphite-100')}>
              {p.label}
            </button>
          ))}
          <select className="rounded-lg border border-graphite-200 px-3 py-2 text-[15px]" value={person}
            onChange={(e) => setPerson(e.target.value)} data-testid="perf-person" aria-label="Ученик">
            <option value="">Все</option>
            {(people.data ?? []).map((p) => (
              <option key={p.profile_id} value={p.profile_id}>
                {(p.full_name ?? p.email ?? p.profile_id.slice(0, 8))}{p.role && p.role !== 'student' ? ` (${p.role})` : ''} · p95 {formatMs(p.route_p95)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-verdict-bad-ink">✕ {(err as Error).message}</p>}

      <section className="platform-surface space-y-4 rounded-card p-4 sm:p-6">
        <h2 className="text-[17px] font-semibold text-graphite-900">Вкладки</h2>
        {routes.isLoading ? <Loader2 className="animate-spin text-graphite-400" size={18} />
          : <SummaryTable rows={routes.data ?? []} selected={activeRoute} onSelect={setRoute} testId="perf-routes" />}
        {activeRoute && (
          <div className="space-y-3 border-t border-graphite-200 pt-4">
            <p className="text-[13px] text-graphite-700">По часам: <span className="font-mono">{activeRoute}</span></p>
            {hourly.isLoading && <Loader2 className="animate-spin text-graphite-400" size={18} />}
            {hourly.data && hourly.data.length > 0 && (
              <>
                <HourBars points={hourly.data} value={(h) => h.p95} format={formatMs} title="p95 вкладки" testId="perf-chart-p95" />
                <HourBars points={hourly.data} value={(h) => h.students} format={(v) => `${v} уч.`} title="Учеников в час (нагрузка)" testId="perf-chart-load" />
              </>
            )}
          </div>
        )}
      </section>

      <section className="platform-surface space-y-3 rounded-card p-4 sm:p-6">
        <h2 className="text-[17px] font-semibold text-graphite-900">Запросы к базе — медленные сверху</h2>
        {apis.isLoading ? <Loader2 className="animate-spin text-graphite-400" size={18} />
          : <SummaryTable rows={(apis.data ?? []).slice(0, 20)} testId="perf-api" />}
      </section>

      {person && (
        <section className="platform-surface space-y-3 rounded-card p-4 sm:p-6" data-testid="perf-recent">
          <h2 className="text-[17px] font-semibold text-graphite-900">Последние события ученика</h2>
          <ul className="divide-y divide-graphite-200 text-[13px]">
            {(recent.data ?? []).map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 py-1">
                <span className="text-graphite-500">{new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
                <span className="text-graphite-500">{e.kind}</span>
                <span className="font-mono">{e.label}</span>
                <span className={cn('font-semibold', e.ms >= 3000 ? 'text-verdict-bad-ink' : 'text-graphite-900')}>{formatMs(e.ms)}</span>
                {e.status != null && e.status >= 400 && <span className="text-verdict-bad-ink">{e.status}</span>}
                <span className="text-graphite-500">{e.device}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
