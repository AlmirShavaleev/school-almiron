import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { feedText, levelProgress, rulesText, type SchoolPoints } from '@/lib/schoolPoints'
import { achievementHint, achievementName, pointsText, type AchievementItem } from '@/lib/achievements'
import { AchievementMedal } from '@/components/achievements/AchievementMedal'
import { useFloatingTip } from './FloatingTip'

/**
 * §255. «Баллы школы» — под «Серией» в правой колонке главной.
 *
 * Только свои баллы: рейтинга класса нет (решение владельца 02.10, п. 4).
 * Сумма, уровень и лента «за что» приходят из базы (`student_school_points`).
 *
 * §257: вместо пяти значков §255 — три последние награды «Достижений»
 * (`awards`, из `student_achievements_sync`) и ссылка «Все достижения →».
 * Один механизм наград, без дублей.
 */
export function SchoolPointsCard({ points, error, onRetry, awards, className }: {
  points: SchoolPoints | null
  error: string | null
  onRetry: () => void
  /** Последние полученные награды; null — ещё не загружены или не загрузились. */
  awards: AchievementItem[] | null
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
        <PointsBody points={points} awards={awards} bind={bind} />
      )}
      {node}
    </section>
  )
}

function PointsBody({ points, awards, bind }: {
  points: SchoolPoints
  awards: AchievementItem[] | null
  bind: ReturnType<typeof useFloatingTip>['bind']
}) {
  const progress = levelProgress(points)
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

      <div className="grid gap-2 border-t border-graphite-100 pt-3" data-testid="points-awards">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-extrabold text-graphite-900">Последние награды</h3>
          <Link to="/achievements" data-testid="points-all-achievements" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-primary-700 hover:underline">
            Все достижения<ChevronRight size={14} aria-hidden />
          </Link>
        </div>
        {awards && awards.length > 0 ? (
          <ul className="grid gap-1.5">
            {awards.map(a => {
              const tip = achievementHint(a)
              return (
                <li
                  key={a.key}
                  tabIndex={0}
                  aria-label={`${achievementName(a)}: ${tip}`}
                  data-award={a.key}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  {...bind(tip)}
                >
                  <AchievementMedal category={a.category} tier={a.tier} size={32} />
                  <span className="min-w-0 break-words text-sm font-semibold text-graphite-800">{achievementName(a)}</span>
                  <b className={cn('text-sm tabular-nums', a.points > 0 ? 'text-gold-600' : 'text-graphite-400')}>{pointsText(a.points)}</b>
                </li>
              )
            })}
          </ul>
        ) : awards ? (
          <p className="text-sm text-graphite-500">Первая награда — за первую верную задачу каталога или сданное ДЗ.</p>
        ) : null}
      </div>

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
