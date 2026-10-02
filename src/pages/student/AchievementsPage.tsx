import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useAchievements } from '@/hooks/useAchievements'
import { useSchoolPoints } from '@/hooks/useSchoolPoints'
import { useFloatingTip } from '@/components/student/home/FloatingTip'
import { AchievementMedal } from '@/components/achievements/AchievementMedal'
import { TIER_STYLE } from '@/components/achievements/achievementStyle'
import {
  achievementHint, achievementLabel, achievementStats, buildLadders, CATEGORY_ORDER, categoryTitle, filterLadders,
  nearest, pointsText, TIER_NAME, type AchievementFilter, type Achievements, type Ladder, type NearView, type Tier,
  type TileView,
} from '@/lib/achievements'
import { levelProgress, type SchoolPoints } from '@/lib/schoolPoints'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §257. «Достижения» — вместо «Мой прогресс» (решение владельца 02.10, макет
 * «Отдавай агенту»).
 *
 * Сверху — уровень и баллы школы (кольцо, полоса до следующего уровня) и
 * четыре счётчика; справа — «Ближайшие награды» (4 текущие ступени с
 * наибольшей долей пути). Ниже — фильтр «Все / Полученные / Ближайшие /
 * категории», легенда уровней и лестницы наград по категориям: полученные —
 * цветом уровня, следующая — рамкой и полоской «23 из 50», остальные серые;
 * «как получить» — подсказкой при наведении и фокусе. Внизу — сворачиваемая
 * «Подробная статистика»: аналитика по номерам, журнал, все ДЗ (было на
 * «Мой прогресс»).
 *
 * Данные: `student_achievements_sync()` (награды, база досчитывает и
 * сохраняет полученные) и `student_school_points()` (сумма уже с баллами
 * наград). Открытие страницы отмечает новые награды просмотренными — счётчик у
 * пункта меню гаснет; метка «новая» на плитке остаётся до ухода со страницы.
 */
export function AchievementsPage() {
  const profile = useAuthStore(s => s.profile)
  const points = useSchoolPoints(profile?.id)
  const { retry: retryPoints } = points
  const ach = useAchievements(profile?.id, { markSeen: true, onFresh: retryPoints })
  const [filter, setFilter] = useState<AchievementFilter>('all')
  const { bind, node } = useFloatingTip()

  const ladders = useMemo(() => (ach.data ? buildLadders(ach.data) : []), [ach.data])
  const shown = useMemo(() => filterLadders(ladders, filter), [ladders, filter])
  const near = useMemo(() => nearest(ladders), [ladders])

  return (
    <div className="mx-auto grid max-w-[1120px] gap-3.5" data-testid="achievements-page">
      <h1 className="text-2xl font-extrabold tracking-tight text-graphite-950 sm:text-[1.55rem]">Достижения</h1>

      <div className="grid grid-cols-1 gap-3.5 min-[860px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LevelCard points={points.points} pointsError={points.error} onRetryPoints={points.retry} data={ach.data} />
        <section aria-labelledby="ach-near-h" data-testid="ach-near" className="platform-surface grid content-start gap-3 rounded-card p-4 sm:p-5">
          <h2 id="ach-near-h" className="text-[15px] font-extrabold text-graphite-950">Ближайшие награды</h2>
          {!ach.data ? (
            <Placeholder error={ach.error} onRetry={ach.retry} />
          ) : near.length === 0 ? (
            <p className="text-sm text-graphite-500">Все лестницы пройдены — остались только особые награды.</p>
          ) : (
            <ul className="grid gap-2.5">
              {near.map(n => <NearRow key={n.item.key} n={n} />)}
            </ul>
          )}
        </section>
      </div>

      {ach.data && (
        <>
          <FilterChips value={filter} onChange={setFilter} ladders={ladders} />
          <Legend data={ach.data} />
          <div className="grid gap-3.5" data-testid="ach-ladders">
            {shown.length === 0 ? (
              <p data-testid="ach-empty" className="platform-surface rounded-card p-4 text-sm text-graphite-500">
                {filter === 'done' ? 'Пока ни одной награды — первая ближе, чем кажется: загляните в «Ближайшие».' : 'Здесь пусто.'}
              </p>
            ) : shown.map(l => <LadderSection key={l.category} ladder={l} bind={bind} />)}
          </div>
        </>
      )}
      {!ach.data && !ach.error && <div className="h-64 animate-pulse rounded-card bg-graphite-100" aria-label="Загружаем" />}

      <details data-testid="ach-details" className="platform-surface rounded-card px-4 py-3 sm:px-5">
        <summary className="cursor-pointer text-[15px] font-extrabold text-graphite-950">Подробная статистика</summary>
        <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <DetailLink to="/student/variants/stats" title="Аналитика по номерам ФИПИ" text="Точность по каждому номеру первой части и что повторить" />
          <DetailLink to="/my-journal" title="Журнал занятий и заданий" text="Все темы, ДЗ и тесты с оценками по дням" />
          <DetailLink to="/my-homework" title="Все домашние задания" text="Сданные, на проверке, на доработке" />
        </div>
      </details>
      {node}
    </div>
  )
}

function Placeholder({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return error ? (
    <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500" data-testid="ach-error">
      <span>Не удалось загрузить награды.</span>
      <button type="button" onClick={onRetry} className="font-semibold text-primary-700 hover:underline">Повторить</button>
    </div>
  ) : (
    <div className="h-24 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
  )
}

function LevelRing({ ratio, level }: { ratio: number; level: number }) {
  const r = 36
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 84 84" className="h-[84px] w-[84px] shrink-0" aria-hidden>
      <circle cx="42" cy="42" r={r} fill="none" className="stroke-graphite-100" strokeWidth="8" />
      <circle
        cx="42" cy="42" r={r} fill="none" className="stroke-gold-400" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} transform="rotate(-90 42 42)"
      />
      <text x="42" y="49" textAnchor="middle" fontSize="20" fontWeight="800" className="fill-graphite-950">{level}</text>
    </svg>
  )
}

function LevelCard({ points, pointsError, onRetryPoints, data }: {
  points: SchoolPoints | null
  pointsError: string | null
  onRetryPoints: () => void
  data: Achievements | null
}) {
  const stats = data ? achievementStats(data) : null
  const progress = points ? levelProgress(points) : null
  return (
    <section aria-labelledby="ach-level-h" data-testid="ach-level" className="platform-surface grid content-start gap-3 rounded-card p-4 sm:p-5">
      <h2 id="ach-level-h" className="text-[15px] font-extrabold text-graphite-950">Уровень и баллы школы</h2>
      {points && progress ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <LevelRing ratio={progress.ratio} level={points.level.n} />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span data-testid="ach-points" className="text-[2.4rem] font-extrabold leading-none tabular-nums text-gold-600">{points.total}</span>
              <span className="text-sm text-graphite-500">
                {plural(points.total, 'балл', 'балла', 'баллов')} · уровень {points.level.n}{points.level.name ? ` «${points.level.name}»` : ''}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-graphite-100" role="progressbar" aria-label="До следующего уровня" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
              <i className="block h-full rounded-full bg-gold-400" style={{ width: `${progress.ratio * 100}%` }} />
            </div>
            <span data-testid="ach-next-level" className="text-[13px] text-graphite-500">{progress.long}</span>
          </div>
        </div>
      ) : (
        <Placeholder error={pointsError} onRetry={onRetryPoints} />
      )}
      {stats && (
        <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4" data-testid="ach-stats">
          <Stat value={stats.earned} label={`${plural(stats.earned, 'награда', 'награды', 'наград')} из ${stats.total}`} />
          <Stat value={stats.catalog} label={`${plural(stats.catalog, 'задача', 'задачи', 'задач')} каталога`} />
          <Stat value={stats.hw} label="ДЗ сдано" />
          <Stat value={stats.streak} label={`${plural(stats.streak, 'день', 'дня', 'дней')} — рекорд серии`} />
        </div>
      )}
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl bg-graphite-50 px-2.5 py-2 ring-1 ring-graphite-100">
      <b className="text-xl font-extrabold tabular-nums text-graphite-950">{value}</b>
      <small className="text-xs leading-tight text-graphite-500">{label}</small>
    </div>
  )
}

function NearRow({ n }: { n: NearView }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5" data-testid="ach-near-row" data-key={n.item.key}>
      <AchievementMedal category={n.item.category} tier={n.item.tier} size={40} />
      <div className="grid min-w-0 gap-0.5">
        <b className="break-words text-sm font-bold text-graphite-900">{n.title}: {achievementLabel(n.item)}</b>
        <small className="text-xs text-graphite-500">{n.item.have} из {n.item.need} · осталось {n.left}</small>
        <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-graphite-100">
          <i className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.round(n.progress * 100)}%` }} />
        </span>
      </div>
      <span className={cn('whitespace-nowrap text-sm font-extrabold', n.item.points > 0 ? 'text-gold-600' : 'text-graphite-400')}>{pointsText(n.item.points)}</span>
    </li>
  )
}

function FilterChips({ value, onChange, ladders }: { value: AchievementFilter; onChange: (f: AchievementFilter) => void; ladders: readonly Ladder[] }) {
  const present = new Set(ladders.map(l => l.category))
  const chips: [AchievementFilter, string][] = [
    ['all', 'Все'], ['done', 'Полученные'], ['near', 'Ближайшие'],
    ...CATEGORY_ORDER.filter(c => present.has(c)).map(c => [c, categoryTitle(c)] as [AchievementFilter, string]),
  ]
  return (
    <div role="group" aria-label="Какие награды показать" className="flex flex-wrap gap-1.5" data-testid="ach-filter">
      {chips.map(([k, t]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          data-filter={k}
          onClick={() => onChange(k)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            value === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-graphite-200 bg-white text-graphite-600 hover:border-primary-300 hover:text-graphite-900',
          )}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function Legend({ data }: { data: Achievements }) {
  const pts = (t: Tier) => data.tiers.find(x => x.tier === t)?.points
  return (
    <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-graphite-500" data-testid="ach-legend">
      {([1, 2, 3, 4] as Tier[]).map(t => (
        <span key={t} className="inline-flex items-center gap-1">
          <i className={cn('inline-block h-3 w-3 rounded-full', TIER_STYLE[t].dot)} aria-hidden />
          {TIER_NAME[t]}{pts(t) != null ? ` +${pts(t)}` : ''}
        </span>
      ))}
      <span>· серая — ещё не получена</span>
    </p>
  )
}

function LadderSection({ ladder, bind }: { ladder: Ladder; bind: ReturnType<typeof useFloatingTip>['bind'] }) {
  return (
    <section
      aria-labelledby={`ach-cat-${ladder.category}`}
      data-testid="ach-ladder"
      data-category={ladder.category}
      className="platform-surface grid gap-2.5 rounded-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`ach-cat-${ladder.category}`} className="text-[15px] font-extrabold text-graphite-950">{ladder.title}</h2>
        <small className="text-[13px] text-graphite-500">{ladder.got} из {ladder.count}</small>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
        {ladder.tiles.map(t => <Tile key={t.item.key} t={t} bind={bind} />)}
      </ul>
    </section>
  )
}

function Tile({ t, bind }: { t: TileView; bind: ReturnType<typeof useFloatingTip>['bind'] }) {
  const { item, state } = t
  const label = achievementLabel(item)
  const hint = achievementHint(item)
  const locked = state !== 'earned'
  return (
    <li
      tabIndex={0}
      aria-label={`${label}: ${hint}`}
      data-testid="ach-tile"
      data-key={item.key}
      data-state={state}
      data-new={item.isNew || undefined}
      className={cn(
        'relative grid content-start justify-items-center gap-1.5 rounded-2xl border bg-white px-2 py-2.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        state === 'current' ? 'border-primary-600 shadow-[0_0_0_2px_theme(colors.primary.100)]' : 'border-graphite-200',
      )}
      {...bind(hint)}
    >
      <span className="relative">
        <AchievementMedal category={item.category} tier={item.tier} locked={locked} />
        <span className={cn(
          'absolute -bottom-1.5 -right-2.5 rounded-full border border-graphite-200 bg-white px-1.5 text-[10.5px] font-extrabold leading-4',
          locked ? 'text-graphite-500' : TIER_STYLE[item.tier].ink,
        )}>
          {item.points > 0 ? `+${item.points}` : '0'}
        </span>
      </span>
      <span className={cn('break-words text-xs font-bold leading-tight', locked ? 'text-graphite-500' : 'text-graphite-900')}>{label}</span>
      {t.sub && <span className="text-[11px] leading-tight text-graphite-500">{t.sub}</span>}
      {item.isNew && (
        <span className="rounded-full bg-gold-300 px-1.5 text-[10px] font-extrabold leading-4 text-graphite-900">новая</span>
      )}
      {state === 'current' && (
        <span className="block h-[5px] w-full overflow-hidden rounded-full bg-graphite-100" aria-hidden>
          <i className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.round(t.progress * 100)}%` }} />
        </span>
      )}
    </li>
  )
}

function DetailLink({ to, title, text }: { to: string; title: string; text: string }) {
  return (
    <Link to={to} className="grid gap-1 rounded-xl border border-graphite-200 p-3 hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      <b className="flex items-center gap-1 text-sm font-bold text-graphite-900">{title}<ChevronRight size={14} aria-hidden /></b>
      <span className="text-[13px] text-graphite-500">{text}</span>
    </Link>
  )
}
