import { cn } from '@/utils/cn'
import { niceMax, weekBarLabel, weeklySolved, type HomeActivity } from '@/lib/studentHome'
import { useFloatingTip } from './FloatingTip'
import { LoadFail } from './LoadFail'

/**
 * §254. «Решено задач по неделям» — 10 недель, текущая акцентом и с числом.
 * Столбики — HTML, а не растянутый SVG: на 390 px подписи остаются читаемыми.
 */
export function WeeklySolvedCard({ activity, error, onRetry, className }: {
  activity: HomeActivity | null
  error: string | null
  onRetry: () => void
  className?: string
}) {
  const { bind, node } = useFloatingTip()
  const bars = activity ? weeklySolved(activity) : []
  const top = niceMax(Math.max(0, ...bars.map(b => b.n)))
  const total = bars.reduce((s, b) => s + b.n, 0)

  return (
    <section aria-labelledby="home-weeks-h" data-testid="weeks-card" className={cn('platform-surface flex flex-col gap-3 rounded-card p-4 sm:p-5', className)}>
      <h2 id="home-weeks-h" className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-extrabold text-graphite-950">
        Решено задач по неделям
        <small className="text-[13px] font-semibold text-graphite-500">ДЗ, каталог, пробники и тесты</small>
      </h2>
      {!activity ? (
        <LoadFail error={error} onRetry={onRetry} />
      ) : (
        <>
          <div className="relative grid flex-1 grid-cols-[auto_minmax(0,1fr)] gap-2" style={{ minHeight: 168 }}>
            <div aria-hidden className="flex flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-graphite-400">
              <span>{top}</span><span>{top / 2}</span><span>0</span>
            </div>
            <div className="relative">
              <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
                <i className="block border-t border-graphite-200" /><i className="block border-t border-graphite-200" /><i className="block border-t border-graphite-200" />
              </div>
              <ol data-testid="week-bars" aria-label="Задачи по неделям за 10 недель" className="relative grid h-full grid-cols-10">
                {bars.map((bar, i) => {
                  const label = weekBarLabel(bar)
                  const h = (bar.n / top) * 100
                  const showLabel = bar.current || i % 2 === 1
                  return (
                    <li
                      key={bar.start}
                      tabIndex={0}
                      aria-label={label}
                      data-week={bar.start}
                      data-n={bar.n}
                      data-current={bar.current || undefined}
                      className="group relative flex flex-col items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      {...bind(label)}
                    >
                      <div className="relative flex w-full flex-1 items-end justify-center">
                        {bar.n > 0 && (
                          <div
                            className={cn('relative w-[56%] max-w-[34px] rounded-t-[4px]', bar.current ? 'bg-primary-600' : 'bg-primary-300 group-hover:bg-primary-400')}
                            style={{ height: `${h}%` }}
                          >
                            {bar.current && (
                              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-extrabold tabular-nums text-graphite-950">{bar.n}</span>
                            )}
                          </div>
                        )}
                        {bar.n === 0 && bar.current && (
                          <span className="absolute bottom-0.5 text-xs font-extrabold text-graphite-950">0</span>
                        )}
                      </div>
                      <span className={cn('flex h-6 items-end whitespace-nowrap text-[11px] text-graphite-400', !showLabel && 'invisible', bar.current && 'font-bold text-graphite-700')}>
                        {bar.label}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
          {total === 0 && (
            <p data-testid="weeks-empty" className="text-sm text-graphite-500">
              Здесь появятся задачи, решённые в ДЗ, каталоге и пробниках.
            </p>
          )}
          {node}
        </>
      )}
    </section>
  )
}
