import { CalendarCheck, Clock, FileText, Star, TrendingUp, type LucideIcon } from 'lucide-react'
import { cn } from '@/utils/cn'
import { buildBadges, feedText, levelProgress, rulesText, type SchoolPoints } from '@/lib/schoolPoints'
import { useFloatingTip } from './FloatingTip'

/**
 * §255. «Баллы школы» — под «Серией» в правой колонке главной.
 *
 * Только свои баллы: рейтинга класса нет (решение владельца 02.10, п. 4).
 * Сумма, уровень, лента «за что» и значки приходят из базы
 * (`student_school_points`), кроме «Прогноз +5» — его считает клиент из
 * прогноза балла (`forecastDelta`).
 */
const BADGE_ICON: Record<string, LucideIcon> = {
  streak7: CalendarCheck,
  ontime10: Clock,
  forecast5: TrendingUp,
  mock1: FileText,
  catalog100: Star,
}

export function SchoolPointsCard({ points, error, onRetry, forecastDelta, className }: {
  points: SchoolPoints | null
  error: string | null
  onRetry: () => void
  forecastDelta: number | null
  className?: string
}) {
  const { bind, node } = useFloatingTip()

  return (
    <section aria-labelledby="home-points-h" data-testid="points-card" className={cn('platform-surface flex flex-col gap-3 rounded-card p-4 sm:p-5', className)}>
      <h2 id="home-points-h" className="text-[15px] font-extrabold text-graphite-950">Баллы школы</h2>
      {!points ? (
        error ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500">
            <span>Не удалось загрузить баллы.</span>
            <button type="button" onClick={onRetry} className="font-semibold text-primary-700 hover:underline">Повторить</button>
          </div>
        ) : (
          <div className="h-24 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
        )
      ) : (
        <PointsBody points={points} forecastDelta={forecastDelta} bind={bind} />
      )}
      {node}
    </section>
  )
}

function PointsBody({ points, forecastDelta, bind }: {
  points: SchoolPoints
  forecastDelta: number | null
  bind: ReturnType<typeof useFloatingTip>['bind']
}) {
  const progress = levelProgress(points)
  const badges = buildBadges(points, forecastDelta)
  const rules = rulesText(points.rules, points.catalogRules)
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span data-testid="points-total" className="text-[2.2rem] font-extrabold leading-none tabular-nums text-gold-600">{points.total}</span>
        <span data-testid="points-level" className="text-sm text-graphite-500">
          уровень {points.level.n}{points.level.name ? ` «${points.level.name}»` : ''}
        </span>
      </div>
      <div className="grid gap-1 text-[13px] text-graphite-500">
        <div className="h-2 overflow-hidden rounded-full bg-graphite-100" role="progressbar" aria-label="До следующего уровня" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
          <i className="block h-full rounded-full bg-gold-400" style={{ width: `${progress.ratio * 100}%` }} />
        </div>
        <span>{progress.text}</span>
      </div>

      {points.feed.length > 0 ? (
        <ul data-testid="points-feed" className="grid gap-1 text-sm">
          {points.feed.map((f, i) => (
            <li key={`${f.kind}-${f.at}-${i}`} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
              <b className="text-right tabular-nums text-gold-600">+{f.points}</b>
              <span className="min-w-0 break-words text-graphite-800">{feedText(f)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="points-empty" className="text-sm text-graphite-500">
          Баллы приходят за сданные вовремя ДЗ, хорошие оценки, задачи каталога, пробники и дни серии.
        </p>
      )}

      <ul className="grid grid-cols-5 gap-1.5" aria-label="Значки" data-testid="points-badges">
        {badges.map(b => {
          const Icon = BADGE_ICON[b.key] ?? Star
          const tip = `${b.title}: ${b.got ? 'получен' : 'ещё нет'} · ${b.hint}`
          return (
            <li
              key={b.key}
              tabIndex={0}
              aria-label={tip}
              data-badge={b.key}
              data-got={b.got || undefined}
              className={cn('grid justify-items-center gap-1 rounded-lg text-center text-[11px] leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', b.got ? 'text-graphite-700' : 'text-graphite-400')}
              {...bind(tip)}
            >
              <span className={cn('grid h-11 w-11 place-items-center rounded-full', b.got ? 'bg-gold-100 text-gold-600' : 'bg-graphite-100 text-graphite-400')}>
                <Icon size={21} strokeWidth={2} aria-hidden />
              </span>
              <span className="break-words">{b.title}</span>
            </li>
          )
        })}
      </ul>

      <details className="text-xs text-graphite-500">
        <summary className="cursor-pointer font-semibold text-graphite-600 hover:text-graphite-900">За что начисляются баллы</summary>
        <ul className="mt-1.5 grid gap-0.5 pl-1">
          {rules.map(r => <li key={r}>· {r}</li>)}
          <li>· Баллы видите только вы — рейтинга класса нет</li>
        </ul>
      </details>
    </>
  )
}
