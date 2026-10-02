import { cn } from '@/utils/cn'
import { ACTIVITY_BG, buildCalendar, type HomeActivity } from '@/lib/studentHome'
import { LoadFail } from './LoadFail'
import { plural } from '@/lib/plural'
import { useFloatingTip } from './FloatingTip'

const DAY_LABELS = ['пн', '', 'ср', '', 'пт', '', 'вс']

/**
 * §254. «Серия»: N дней подряд, рекорд и календарь активности за 12 недель.
 * День в серию засчитывает ЗАХОД (app_visits); цвет клетки — сколько задач
 * решено (ступени `activityLevel`). Серию и рекорд считает база.
 */
export function StreakCard({ activity, error, onRetry, className }: {
  activity: HomeActivity | null
  error: string | null
  onRetry: () => void
  className?: string
}) {
  const { bind, node } = useFloatingTip()

  return (
    <section aria-labelledby="home-streak-h" data-testid="streak-card" className={cn('platform-surface flex flex-col gap-3 rounded-card p-4 sm:p-5', className)}>
      <h2 id="home-streak-h" className="text-[15px] font-extrabold text-graphite-950">Серия</h2>
      {!activity ? (
        <LoadFail error={error} onRetry={onRetry} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span data-testid="streak-number" className="text-[2.6rem] font-extrabold leading-none tabular-nums text-graphite-950">{activity.streak}</span>
            {activity.record > 0 ? (
              <span className="text-sm text-graphite-500">
                {plural(activity.streak, 'день', 'дня', 'дней')} подряд · рекорд — {activity.record} {plural(activity.record, 'день', 'дня', 'дней')}
              </span>
            ) : (
              <span data-testid="streak-newbie" className="text-sm text-graphite-500">Заходите каждый день — здесь появится ваша серия</span>
            )}
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5">
            <div aria-hidden className="grid grid-rows-[repeat(7,16px)] gap-[3px] text-[10px] leading-none text-graphite-400">
              {DAY_LABELS.map((d, i) => <span key={i} className="flex items-center">{d}</span>)}
            </div>
            <div
              role="group"
              aria-label="Активность за 12 недель"
              data-testid="activity-calendar"
              className="grid auto-cols-[16px] grid-flow-col grid-rows-[repeat(7,16px)] gap-[3px] overflow-x-auto"
            >
              {buildCalendar(activity).flat().map(cell => (
                cell.future ? (
                  <i key={cell.day} data-day={cell.day} data-future="" className="block h-4 w-4 rounded border border-dashed border-graphite-300" />
                ) : (
                  <i
                    key={cell.day}
                    role="img"
                    tabIndex={0}
                    aria-label={cell.label}
                    data-day={cell.day}
                    data-level={cell.level}
                    data-today={cell.today || undefined}
                    className={cn(
                      'block h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      ACTIVITY_BG[cell.level],
                      cell.today && 'outline outline-2 outline-offset-1 outline-gold-400',
                    )}
                    {...bind(cell.label)}
                  />
                )
              ))}
            </div>
          </div>
          <Legend />
          {node}
        </>
      )}
    </section>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-graphite-500">
      <span>меньше</span>
      <span className="inline-flex gap-0.5" aria-hidden>
        {ACTIVITY_BG.map(c => <i key={c} className={cn('h-2.5 w-4 rounded-sm', c)} />)}
      </span>
      <span>больше задач за день</span>
    </div>
  )
}
