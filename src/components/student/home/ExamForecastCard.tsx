import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { plural } from '@/lib/plural'
import { shortDay } from '@/lib/studentHome'
import { activeSpec, type EgeSubject } from '@/lib/egeScales'
import {
  buildForecastView, catalogTips, gainText, missingText, parseGoalInput, tileHint, tileLevel,
  type CatalogTip, type ForecastResponse, type ForecastView, type NumberStat,
} from '@/lib/egeForecast'
import { useFloatingTip } from './FloatingTip'

/**
 * §255. «Примерный балл на ЕГЭ» — первая карточка левой колонки главной.
 *
 * База отдаёт только свидетельства (`student_exam_forecast_evidence`), весь
 * расчёт — `buildForecastView` (egeForecast.ts): балл, диапазон, «+N за
 * месяц», 8 недель, плитки КИМ и (§256) «Решите в каталоге — и балл вырастет»:
 * номер, «верно k из 10», «≈ +N к прогнозу за 10 верных» (симуляция той же
 * моделью) и кнопка в раздел каталога этого номера. Пока данных
 * мало (покрыто меньше половины номеров части 1) — вместо балла честное
 * «решите ещё N задач из разных номеров» и полоса покрытия.
 *
 * Цель ставит сам ученик (решение владельца 02.10): отметка на шкале и
 * маленькая форма 1..100; учитель видит её в карточке ученика.
 */
const TILE_BG = ['', 'bg-primary-100', 'bg-primary-300', 'bg-primary-500', 'bg-primary-800'] as const
const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, #edf1f9 0 5px, #ffffff 5px 9px)',
}

export function ExamForecastCard({ data, error, onRetry, onSetGoal, className }: {
  data: ForecastResponse | null
  error: string | null
  onRetry: () => void
  onSetGoal: (subject: EgeSubject, goal: number | null) => Promise<void>
  className?: string
}) {
  const subjects = useMemo(() => (data?.subjects ?? []).filter(s => activeSpec(s.subject)), [data])
  const [picked, setPicked] = useState<EgeSubject | null>(null)
  const subject = subjects.find(s => s.subject === picked) ?? subjects[0] ?? null
  const view = useMemo<ForecastView | null>(() => {
    if (!data || !subject) return null
    const spec = activeSpec(subject.subject)
    return spec ? buildForecastView(spec, data.evidence, data.now) : null
  }, [data, subject])

  if (data && subjects.length === 0) return null

  return (
    <section aria-labelledby="home-forecast-h" data-testid="forecast-card" className={cn('platform-surface flex flex-col gap-3.5 rounded-card p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="home-forecast-h" className="text-[15px] font-extrabold text-graphite-950">Примерный балл на ЕГЭ</h2>
        {subjects.length > 1 && (
          <div role="group" aria-label="Предмет" className="ml-auto inline-flex overflow-hidden rounded-[10px] border border-graphite-200">
            {subjects.map(s => (
              <button
                key={s.subject}
                type="button"
                aria-pressed={s.subject === subject?.subject}
                data-testid={`forecast-subject-${s.subject}`}
                onClick={() => setPicked(s.subject)}
                className={cn(
                  'px-3 py-1.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                  s.subject === subject?.subject ? 'bg-primary-600 text-white' : 'bg-white text-graphite-500 hover:text-graphite-900',
                )}
              >
                {activeSpec(s.subject)?.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!data || !view || !subject ? (
        error ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500">
            <span>Не удалось загрузить прогноз.</span>
            <button type="button" onClick={onRetry} className="font-semibold text-primary-700 hover:underline">Повторить</button>
          </div>
        ) : (
          <div className="h-40 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
        )
      ) : (
        <ForecastBody
          key={subject.subject}
          view={view}
          data={data}
          goal={subject.goal}
          teacherGoal={subject.teacherGoal}
          titles={data.titles}
          onSetGoal={goal => onSetGoal(subject.subject, goal)}
        />
      )}
    </section>
  )
}

function ForecastBody({ view, data, goal, teacherGoal, titles, onSetGoal }: {
  view: ForecastView
  data: ForecastResponse
  goal: number | null
  teacherGoal: number | null
  titles: Record<string, string>
  onSetGoal: (goal: number | null) => Promise<void>
}) {
  const { bind, node } = useFloatingTip()
  const { spec, current } = view
  const titleOf = (n: number) => titles[`${spec.subject}:${n}`] ?? null
  const part1 = current.numbers.filter(s => s.part === 1)
  const part2 = current.numbers.filter(s => s.part === 2)
  const cols = part1.length > 12 ? 10 : part1.length

  return (
    <>
      {current.ready ? (
        <div data-testid="forecast-ready" className="flex flex-wrap items-end gap-x-6 gap-y-1.5">
          <div className="text-[3.4rem] font-extrabold leading-[0.95] tracking-tight tabular-nums text-graphite-950 sm:text-[3.6rem]">
            <span data-testid="forecast-score">{view.score}</span>
            <small className="ml-1.5 text-base font-bold tracking-normal text-graphite-500">из 100</small>
          </div>
          <div className="grid gap-0.5 pb-1.5">
            {view.monthDelta != null && (
              <span data-testid="forecast-delta" className={cn('font-extrabold', view.monthDelta > 0 ? 'text-verdict-ok-ink' : 'text-graphite-600')}>
                {view.monthDelta > 0 ? `+${view.monthDelta} за месяц` : view.monthDelta < 0 ? `−${-view.monthDelta} за месяц` : 'как месяц назад'}
              </span>
            )}
            <span data-testid="forecast-range" className="text-sm text-graphite-500">скорее всего от {view.low} до {view.high}</span>
          </div>
        </div>
      ) : (
        <div data-testid="forecast-missing" className="grid gap-2">
          <p className="text-[15px] font-bold text-graphite-950">{missingText(current.missing, plural)}</p>
          <div className="grid gap-1">
            <div
              className="h-2.5 overflow-hidden rounded-full bg-graphite-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={current.need}
              aria-valuenow={current.covered}
              aria-label="Покрытие номеров части 1"
            >
              <i className="block h-full rounded-full bg-primary-500" style={{ width: `${(current.covered / current.need) * 100}%` }} />
            </div>
            <span className="text-xs text-graphite-500">
              есть решения по {current.covered} из {current.need} {plural(current.need, 'номера', 'номеров', 'номеров')} части 1 — столько нужно для прогноза
            </span>
          </div>
        </div>
      )}

      <ScoreScale view={view} goal={goal} />
      <GoalRow goal={goal} teacherGoal={teacherGoal} year={spec.year} onSetGoal={onSetGoal} />

      {current.ready && <Spark view={view} bind={bind} />}

      <div className="grid gap-1.5">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-graphite-400">Задания КИМ · как решаете</div>
        <KimTiles label="часть 1" stats={part1} cols={cols} bind={bind} titleOf={titleOf} />
        <KimTiles label="часть 2" stats={part2} cols={cols} bind={bind} titleOf={titleOf} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite-500">
          <span className="inline-flex items-center gap-1.5">
            решаете
            <span className="inline-flex gap-0.5" aria-hidden>
              {TILE_BG.slice(1).map(c => <i key={c} className={cn('h-2.5 w-4 rounded-sm', c)} />)}
            </span>
            реже ↔ почти всегда
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="h-2.5 w-4 rounded-sm border border-graphite-200" style={HATCH} />пока не решали
          </span>
        </div>
      </div>

      <CatalogTipsBlock view={view} data={data} />

      <Sources view={view} />
      {node}
    </>
  )
}

/** Шкала 0–100: заливка до балла, полоса диапазона, отметки порога и цели. */
function ScoreScale({ view, goal }: { view: ForecastView; goal: number | null }) {
  const { spec, current } = view
  const ticks: { key: string; at: number; text: string; gold?: boolean; up?: boolean }[] = [
    { key: 'min', at: spec.threshold, text: `порог ${spec.threshold}` },
  ]
  if (goal != null) ticks.push({ key: 'goal', at: goal, text: `цель ${goal}`, gold: true, up: Math.abs(goal - spec.threshold) < 16 })
  return (
    <div data-testid="forecast-scale" className="relative h-[52px]" aria-hidden>
      <div className="absolute inset-x-0 top-[18px] h-2.5 rounded-full bg-graphite-100" />
      {current.ready && (
        <>
          <div className="absolute top-[14px] h-[18px] rounded-md bg-primary-500/20" style={{ left: `${view.low}%`, width: `${Math.max(1, view.high - view.low)}%` }} />
          <div className="absolute left-0 top-[18px] h-2.5 rounded-full bg-primary-600" style={{ width: `${view.score}%` }} />
        </>
      )}
      {ticks.map(t => (
        <div key={t.key} data-tick={t.key} className={cn('absolute top-[10px] h-[26px] w-0.5 rounded', t.gold ? 'bg-gold-500' : 'bg-graphite-500')} style={{ left: `calc(${t.at}% - 1px)` }}>
          <span
            className={cn('absolute whitespace-nowrap text-[11px] font-bold', t.gold ? 'text-gold-700' : 'text-graphite-500', t.up ? '-top-[14px]' : 'top-[28px]')}
            style={{ left: '50%', transform: `translateX(${t.at > 88 ? '-100%' : t.at < 8 ? '0' : '-50%'})` }}
          >
            {t.text}
          </span>
        </div>
      ))}
    </div>
  )
}

function GoalRow({ goal, teacherGoal, year, onSetGoal }: {
  goal: number | null
  teacherGoal: number | null
  year: number
  onSetGoal: (goal: number | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(goal == null ? '' : String(goal))
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!editing) setText(goal == null ? '' : String(goal)) }, [goal, editing])

  async function save(next: number | null) {
    setSaving(true)
    setErr(null)
    try {
      await onSetGoal(next)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить цель')
    } finally {
      setSaving(false)
    }
  }

  function submit() {
    const parsed = parseGoalInput(text)
    if (!parsed.ok) { setErr(parsed.error); return }
    void save(parsed.goal)
  }

  if (!editing) {
    return (
      <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-graphite-500">
        <span>по шкале ЕГЭ-{year}</span>
        <button
          type="button"
          data-testid="forecast-goal-edit"
          onClick={() => { setEditing(true); setErr(null) }}
          className="font-bold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          {goal == null ? 'Поставить цель' : `Цель ${goal} · изменить`}
        </button>
      </div>
    )
  }

  return (
    <form
      data-testid="forecast-goal-form"
      onSubmit={e => { e.preventDefault(); submit() }}
      className="grid gap-2 rounded-xl border border-gold-200 bg-gold-50 p-3"
    >
      <label htmlFor="forecast-goal-input" className="text-sm font-bold text-graphite-900">Сколько баллов хотите набрать?</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="forecast-goal-input"
          data-testid="forecast-goal-input"
          type="text"
          inputMode="numeric"
          autoFocus
          maxLength={3}
          value={text}
          placeholder="80"
          aria-invalid={err ? true : undefined}
          aria-describedby="forecast-goal-help"
          onChange={e => { setText(e.target.value.replace(/[^\d]/g, '')); setErr(null) }}
          className="h-10 w-20 rounded-xl border border-graphite-300 bg-white px-3 text-center text-base font-extrabold tabular-nums text-graphite-950 focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <button type="submit" disabled={saving} className="h-10 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-60">
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" onClick={() => { setEditing(false); setErr(null) }} className="h-10 rounded-xl px-3 text-sm font-semibold text-graphite-600 hover:text-graphite-900">
          Отмена
        </button>
        {goal != null && (
          <button type="button" data-testid="forecast-goal-clear" disabled={saving} onClick={() => void save(null)} className="h-10 rounded-xl px-1 text-sm font-semibold text-graphite-500 hover:text-graphite-900">
            Убрать цель
          </button>
        )}
      </div>
      <p id="forecast-goal-help" className={cn('text-xs', err ? 'font-semibold text-verdict-bad-ink' : 'text-graphite-500')} role={err ? 'alert' : undefined}>
        {err ?? `От 1 до 100. Цель видит ваш учитель${teacherGoal != null ? ` · учитель предлагает ${teacherGoal}` : ''}.`}
      </p>
    </form>
  )
}

type Bind = ReturnType<typeof useFloatingTip>['bind']

/** Линия за 8 недель. SVG без подписей (тянется по ширине), точки и подсказки — HTML. */
function Spark({ view, bind }: { view: ForecastView; bind: Bind }) {
  const pts = view.trend
  const vals = pts.map(p => p.score).filter((v): v is number => v != null)
  const lo = Math.min(...vals) - 3, hi = Math.max(...vals) + 3
  const W = 600, H = 72, pad = 8
  const X = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1)
  const Y = (v: number) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * pad)
  // Недели, когда данных не хватало, — разрыв линии, а не провал в ноль.
  const segs: string[] = []
  let cur = ''
  pts.forEach((p, i) => {
    if (p.score == null) { if (cur) segs.push(cur); cur = ''; return }
    cur += `${cur ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.score).toFixed(1)} `
  })
  if (cur) segs.push(cur)
  const last = pts[pts.length - 1]
  const label = (i: number) => {
    const p = pts[i]
    const head = p.current ? 'сейчас' : `неделя до ${shortDay(p.day)}`
    return p.score == null ? `${head}: данных ещё мало` : `${head}: прогноз ${p.score}`
  }
  return (
    <div className="relative" data-testid="forecast-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[72px] w-full" role="img" aria-label="Как менялся прогноз за 8 недель">
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="#1f55e0" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {last.score != null && (
        <i
          aria-hidden
          className="absolute h-2.5 w-2.5 rounded-full border-2 border-white bg-primary-600"
          style={{ left: `calc(${(X(pts.length - 1) / W) * 100}% - 5px)`, top: `${Y(last.score) - 5}px` }}
        />
      )}
      <ol className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${pts.length}, minmax(0, 1fr))` }} aria-label="Прогноз по неделям">
        {pts.map((p, i) => (
          <li key={p.day} tabIndex={0} aria-label={label(i)} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" {...bind(label(i))} />
        ))}
      </ol>
      <div aria-hidden className="mt-0.5 flex justify-between text-[11px] text-graphite-400">
        <span>{shortDay(pts[0].day)}</span><span className="font-bold text-graphite-600">сейчас</span>
      </div>
    </div>
  )
}

function KimTiles({ label, stats, cols, bind, titleOf }: {
  label: string
  stats: NumberStat[]
  cols: number
  bind: Bind
  titleOf: (n: number) => string | null
}) {
  if (stats.length === 0) return null
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold text-graphite-500">{label}</span>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid={`kim-${label === 'часть 1' ? 'part1' : 'part2'}`}>
        {stats.map(s => {
          const level = tileLevel(s)
          const title = titleOf(s.n)
          const hint = tileHint(s, plural) + (title ? ` · ${title}` : '')
          return (
            <button
              key={s.n}
              type="button"
              data-n={s.n}
              data-level={level}
              aria-label={hint}
              className={cn(
                'grid h-9 place-items-center rounded-lg text-[13px] font-extrabold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                level === 0 ? 'text-graphite-400' : TILE_BG[level],
                level >= 3 ? 'text-white' : level > 0 ? 'text-graphite-900' : '',
              )}
              style={level === 0 ? HATCH : undefined}
              {...bind(hint)}
            >
              {s.n}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Sources({ view }: { view: ForecastView }) {
  const { hw, test, catalog, mock } = view.sources
  const chips: [string, string][] = [['ДЗ', `${hw} ${plural(hw, 'задача', 'задачи', 'задач')}`]]
  if (test > 0) chips.push(['тесты', String(test)])
  chips.push(['каталог', String(catalog)], ['пробник', String(mock)])
  return (
    <div data-testid="forecast-sources" className="flex flex-wrap items-center gap-1.5 text-xs text-graphite-500">
      <span>Считаем по последним решениям:</span>
      {chips.map(([k, v]) => (
        <span key={k} className="rounded-full bg-graphite-50 px-2.5 py-0.5">{k} · <b className="text-graphite-900">{v}</b></span>
      ))}
    </div>
  )
}

/**
 * §256. «Решите в каталоге — и балл вырастет»: до трёх номеров «зоны роста» и
 * «в процессе» с наибольшим приростом (≈ +N за 10 верных — та же модель),
 * «верно k из 10» — засчитанные задачи каталога до следующей вехи. Номера
 * «уверенно» — тихой строкой «≈ +1, почти максимум» без кнопки.
 */
function CatalogTipsBlock({ view, data }: { view: ForecastView; data: ForecastResponse }) {
  const { tips, confident } = useMemo(() => catalogTips(view.spec, data, view.current), [view, data])
  if (tips.length === 0 && confident.length === 0) return null
  const href = (t: CatalogTip) => `/catalog/${t.sectionId}?subject=${view.spec.subject}&exam=ege`
  const solvedText = (t: CatalogTip) => (t.next != null ? `верно ${t.solved} из ${t.next}` : `верно ${t.solved}`)
  return (
    <div className="grid gap-1.5" data-testid="forecast-catalog">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-graphite-400">
        {view.current.ready ? 'Решите в каталоге — и балл вырастет' : 'Решите в каталоге — и мы покажем балл'}
      </div>
      {tips.length > 0 && (
        <ul className="grid gap-1.5">
          {tips.map(t => (
            <li key={t.n} data-n={t.n} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 rounded-xl border border-graphite-200 px-3 py-2.5">
              <span className="rounded-lg bg-primary-50 px-2 py-0.5 text-sm font-extrabold text-primary-700">№{t.n}</span>
              <span className="grid min-w-0 gap-0.5">
                <b className="break-words text-sm font-bold text-graphite-900">{t.title ?? `Задание №${t.n}`}</b>
                <small className="text-xs text-graphite-500">{t.solved === 0 && t.gain == null ? 'ещё не решали' : solvedText(t)}</small>
              </span>
              <span className="text-right text-sm font-extrabold leading-tight text-verdict-ok-ink">
                {t.gain != null ? (
                  <>{gainText(t.gain)}<br /><small className="text-xs font-semibold text-graphite-500">за 10 верных</small></>
                ) : (
                  <small className="text-xs font-semibold text-graphite-500">откроет прогноз</small>
                )}
              </span>
              <Link
                to={href(t)}
                data-testid={`forecast-catalog-go-${t.n}`}
                className="col-span-3 justify-self-start rounded-[10px] bg-primary-50 px-3 py-1.5 text-[13px] font-extrabold text-primary-700 ring-1 ring-primary-200 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                Решать №{t.n} →
              </Link>
            </li>
          ))}
        </ul>
      )}
      {confident.length > 0 && (
        <p data-testid="forecast-catalog-confident" className="text-xs text-graphite-500">
          Уже уверенно: {confident.map(t => `№${t.n}`).join(', ')} — там ≈ +1, почти максимум
        </p>
      )}
    </div>
  )
}
