import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart3, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { plural, pluralTopics } from '@/lib/plural'
import type { Module, Topic } from '@/hooks/useCourseProgram'
import type { TopicHomeworkRow } from '@/lib/topicHomeworkState'
import {
  MATERIAL_VIEWS_SINCE, STATS_PERIODS, VIDEO_SINCE,
  daysBetween, formatAgo, formatDayMonth, formatDayShort, formatDelta, formatDuration, formatScore,
  isLow, moscowDay, nextSort, percent, pickAvg, prevPeriodLabel, sortStudents,
  type CourseStatsSummary, type CourseStudentsStats, type CourseTopicsStats, type StatsPeriod, type StatsView,
  type StudentSort, type StudentSortKey, type TopicStats, type TopicStudentRow,
} from '@/lib/courseStats'
import { useTopicStudentsStats } from '@/hooks/useCourseStats'
import { TopicKindMark } from './TopicKindMark'
import { TopicOpenToggle } from './TopicOpenToggle'
import { TopicHomeworkBadge } from './TopicHomeworkBadge'

/**
 * §242. Статистика курса у учителя на вкладке «Программа курса»: панель со
 * сводкой за период, переключатель «По темам / По ученикам», таблица тем с
 * новыми столбцами (и раскрытием темы по ученикам) и таблица класса.
 *
 * Числа — из базы (PENDING_242), здесь только раскладка. Цвета — как в
 * утверждённом макете: полоски primary-600 (#1f55e0), слабые и старые столбики
 * primary-300 (#93b4ff), статусы — токены verdict/gold.
 *
 * На телефоне плитки по две в ряд, а таблицы прокручиваются вбок ВНУТРИ
 * своего блока: страница вбок не едет.
 */

const pluralStudents = (n: number) => `${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`

// ─── Переключатели ──────────────────────────────────────────────────────────

function Seg<K extends string>({ label, items, value, onChange, testId }: {
  label: string
  items: { key: K; label: string }[]
  value: K
  onChange: (k: K) => void
  testId: string
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="inline-flex shrink-0 gap-[3px] rounded-xl bg-slate-100 p-[3px]">
      {items.map(it => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          data-key={it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            'min-h-9 rounded-[9px] px-3 text-[12.5px] font-bold transition-colors sm:min-h-0 sm:py-1.5',
            value === it.key ? 'bg-white text-primary-900 shadow-[0_1px_2px_rgba(20,32,61,.12)]' : 'text-graphite-600 hover:text-graphite-900',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function StatsViewSwitch({ value, onChange }: { value: StatsView; onChange: (v: StatsView) => void }) {
  return (
    <Seg
      label="Разрез"
      testId="stats-view"
      items={[{ key: 'topics', label: 'По темам' }, { key: 'students', label: 'По ученикам' }]}
      value={value}
      onChange={onChange}
    />
  )
}

// ─── Панель сводки ──────────────────────────────────────────────────────────

function Tile({ label, value, sub, warn, testId }: { label: string; value: ReactNode; sub: ReactNode; warn?: boolean; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-white px-4 py-3.5" data-testid={testId}>
      <span className="text-xs text-graphite-600">{label}</span>
      <span className={cn('text-[26px] font-extrabold leading-tight tabular-nums', warn ? 'text-gold-700' : 'text-primary-900')}>{value}</span>
      <span className="text-[11.5px] leading-snug text-graphite-600">{sub}</span>
    </div>
  )
}

export function CourseStatsPanel({ data, period, onPeriod, loading, onShowQuiet }: {
  data: CourseStatsSummary
  period: StatsPeriod
  onPeriod: (p: StatsPeriod) => void
  loading?: boolean
  /** «Показать в таблице учеников» — разрез «По ученикам», дольше всех не заходившие сверху. */
  onShowQuiet: () => void
}) {
  const prevLabel = prevPeriodLabel(data.period)
  const delta = data.viewsPrev === null ? null : data.views - data.viewsPrev
  const avg = data.avgFive !== null
    ? { v: formatScore(data.avgFive, 'five'), sub: `по пятибалльной · ${data.avgFiveCount} ${plural(data.avgFiveCount, 'оценка', 'оценки', 'оценок')}` }
    : data.avgHundred !== null
      ? { v: formatScore(data.avgHundred, 'hundred'), sub: `из 100 · ${data.avgHundredCount} ${plural(data.avgHundredCount, 'оценка', 'оценки', 'оценок')}` }
      : { v: '—', sub: 'оценок за период нет' }
  const oldest = data.pendingOldestAt ? Math.max(0, daysBetween(moscowDay(data.pendingOldestAt), data.to)) : null

  return (
    <section
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
      data-testid="course-stats"
      data-period={data.period}
      aria-labelledby="course-stats-title"
      aria-busy={loading ? 'true' : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3">
        <h2 id="course-stats-title" className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-primary-900">
          <BarChart3 size={16} className="shrink-0 text-primary-600" aria-hidden />
          <span>Статистика курса · {pluralStudents(data.inClass)}</span>
          {loading && <Loader2 size={14} className="animate-spin text-graphite-400" aria-label="Обновляем" />}
        </h2>
        <Seg label="Период" testId="stats-period" items={STATS_PERIODS} value={period} onChange={onPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          testId="stats-tile-active"
          label="Заходили в курс"
          value={<>{data.active} <small className="text-sm font-bold text-graphite-600">из {data.inClass}</small></>}
          sub="открывали материалы, смотрели видео или сдавали"
        />
        <Tile
          testId="stats-tile-views"
          label="Открыли файлов темы"
          value={data.views}
          sub={
            <>
              {plural(data.views, 'раз', 'раза', 'раз')}
              {delta !== null && prevLabel ? (
                <> · <span className={cn('font-bold', delta > 0 && 'text-verdict-ok-ink', delta < 0 && 'text-verdict-bad-ink')}>{formatDelta(delta)}</span> {prevLabel}</>
              ) : data.period === 'all' ? <> · считаем с {formatDayMonth(MATERIAL_VIEWS_SINCE)}</> : null}
            </>
          }
        />
        <Tile
          testId="stats-tile-video"
          label="Видео"
          value={formatDuration(data.videoSeconds)}
          sub={<>досмотрено {data.videoDone} {plural(data.videoDone, 'ролик', 'ролика', 'роликов')}{data.period === 'all' ? <> · с {formatDayMonth(VIDEO_SINCE)}</> : null}</>}
        />
        <Tile
          testId="stats-tile-hw"
          label="Сдано ДЗ"
          value={data.submitted}
          sub={`принято ${data.accepted} · вернули ${data.returned}`}
        />
        <Tile
          testId="stats-tile-pending"
          label="Ждут проверки"
          warn={data.pending > 0}
          value={data.pending}
          sub={oldest === null ? 'очередь пуста' : oldest === 0 ? 'самая старая — сегодня' : `самая старая — ${oldest} ${plural(oldest, 'день', 'дня', 'дней')}`}
        />
        <Tile testId="stats-tile-avg" label="Средний балл ДЗ" value={avg.v} sub={avg.sub} />
      </div>

      <div className="grid border-t border-gray-100 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-gray-100 px-4 py-3.5 lg:border-b-0 lg:border-r">
          <div className="mb-1.5 flex justify-between gap-2 text-xs text-graphite-600">
            <span>Активные ученики по дням</span>
            <span className="tabular-nums">макс. {data.inClass}</span>
          </div>
          <ActivityChart days={data.days} max={data.inClass} />
        </div>
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3.5" data-testid="stats-quiet">
          <span className="text-xs text-graphite-600">Не заходили 7 дней и больше</span>
          {data.quiet.length === 0 ? (
            <span className="text-[12.5px] text-graphite-500">таких нет</span>
          ) : (
            <PeopleChips people={data.quiet} testId="stats-quiet-list" />
          )}
          {data.quiet.length > 0 && (
            <button type="button" onClick={onShowQuiet} className="self-start text-[12.5px] font-bold text-primary-600 hover:text-primary-700">
              Показать в таблице учеников →
            </button>
          )}
          <span className="mt-1.5 text-xs text-graphite-600">Не сдали ни одного ДЗ за 14 дней</span>
          {data.noHw14.length === 0 ? (
            <span className="text-[12.5px] text-graphite-500">таких нет</span>
          ) : (
            <PeopleChips people={data.noHw14} testId="stats-nohw-list" />
          )}
        </div>
      </div>
    </section>
  )
}

/** «Морозова К.» — фамилия и инициал: в чипе полное ФИО не помещается. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full.trim()
  return `${parts[0]} ${parts[1][0]}.`
}

function PeopleChips({ people, testId }: { people: { student_id: string; full_name: string }[]; testId: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {people.map(p => (
        <Link
          key={p.student_id}
          to={`/students/${p.student_id}`}
          title={p.full_name}
          className="rounded-full bg-verdict-bad-tint px-2.5 py-0.5 text-[12.5px] font-semibold text-verdict-bad-ink hover:underline"
        >
          {shortName(p.full_name)}
        </Link>
      ))}
    </div>
  )
}

// ─── Активность по дням ─────────────────────────────────────────────────────

const CH = { W: 560, H: 100, x0: 28, top: 10 }

export function ActivityChart({ days, max }: { days: { day: string; active: number }[]; max: number }) {
  const [tip, setTip] = useState<number | null>(null)
  const top = Math.max(1, max, ...days.map(d => d.active))
  const bw = (CH.W - CH.x0) / Math.max(1, days.length)
  const y = (v: number) => CH.top + CH.H - (v / top) * CH.H * 0.9
  const ticks = Array.from(new Set([0, Math.round(top / 2), top]))
  const cur = tip === null ? null : days[tip]
  const label = days.map(d => `${formatDayShort(d.day)}: ${d.active}`).join(', ')

  return (
    <div className="relative" data-testid="activity-chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${CH.W} 120`} className="block h-auto w-full" role="img" aria-label={`Активные ученики по дням за ${days.length} дней: ${label}`}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={CH.x0} x2={CH.W} y1={y(v)} y2={y(v)} stroke="#eef1f7" />
            <text x={CH.x0 - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#55607a">{v}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const h = (d.active / top) * CH.H * 0.9
          const recent = i >= days.length - 7
          return (
            <rect
              key={d.day}
              x={CH.x0 + i * bw + 2}
              y={CH.top + CH.H - h}
              width={Math.max(1, bw - 4)}
              height={h}
              rx={3}
              fill={recent ? '#1f55e0' : '#93b4ff'}
              data-testid="activity-bar"
              data-active={d.active}
            />
          )
        })}
        {days.map((d, i) => (
          <rect
            key={`hit-${d.day}`}
            x={CH.x0 + i * bw}
            y={0}
            width={bw}
            height={120}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${formatDayShort(d.day)} — активны ${d.active} из ${max}`}
            data-testid="activity-hit"
            onMouseEnter={() => setTip(i)}
            onFocus={() => setTip(i)}
            onBlur={() => setTip(null)}
            onClick={() => setTip(i)}
            className="cursor-pointer outline-none focus-visible:fill-primary-100/40"
          />
        ))}
        <text x={CH.W} y={118} textAnchor="end" fontSize="10" fill="#55607a">последние 7 дней — тёмные</text>
      </svg>
      {cur && tip !== null && (
        <div
          role="status"
          data-testid="activity-tip"
          className="pointer-events-none absolute whitespace-nowrap rounded-lg bg-graphite-900 px-2 py-1 text-[11.5px] text-white"
          style={{
            left: `clamp(70px, ${((CH.x0 + tip * bw + bw / 2) / CH.W) * 100}%, calc(100% - 70px))`,
            top: `${(y(cur.active) / 120) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          {formatDayShort(cur.day)} — активны {cur.active} из {max}
        </div>
      )}
    </div>
  )
}

// ─── Полоска ────────────────────────────────────────────────────────────────

function Meter({ part, whole, testId }: { part: number; whole: number; testId?: string }) {
  const pct = percent(part, whole)
  return (
    <div className="flex min-w-[120px] items-center gap-2" data-testid={testId} data-value={`${part}/${whole}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
        <i className={cn('block h-full rounded-full', isLow(part, whole) ? 'bg-primary-300' : 'bg-primary-600')} style={{ width: `${pct}%` }} />
      </div>
      <span className="min-w-[38px] text-right text-[12.5px] tabular-nums text-graphite-900">{part}/{whole}</span>
    </div>
  )
}

const Dash = ({ children = '—', title }: { children?: ReactNode; title?: string }) => (
  <span className="text-xs text-graphite-400" title={title}>{children}</span>
)

// ─── По темам ───────────────────────────────────────────────────────────────

export interface LegacyHomeworkCount { templateCount: number; assignmentCount: number }

export function StatsTopicsTable({
  modules, stats, inClass, loading, plain, courseId, period, legacyHw, homeworkStateByTopic,
  onOpenTopic, onOpenHomeworkTab, onToggleTopicOpen,
}: {
  modules: Module[]
  /** Статистика по темам; null при `plain` (каркас, пустой класс). */
  stats: CourseTopicsStats | null
  inClass: number
  loading?: boolean
  /** Без столбцов статистики — только темы (каркас курса, в классе никого). */
  plain?: boolean
  courseId: string
  period: StatsPeriod
  /** Шаблоны/назначения ДЗ V2 темы — то, что считали старые столбцы; меткой у названия. */
  legacyHw: Record<string, LegacyHomeworkCount>
  homeworkStateByTopic: Record<string, TopicHomeworkRow[]>
  onOpenTopic: (topic: Topic, moduleTitle: string) => void
  onOpenHomeworkTab: () => void
  onToggleTopicOpen: (topicId: string, isOpen: boolean) => Promise<void>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const cols = plain ? 1 : 6
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white" data-testid="stats-topics">
      <div className="overflow-x-auto" data-testid="stats-topics-scroll">
        <table className={cn('w-full text-[13.5px]', !plain && 'min-w-[900px]')}>
          <thead>
            <tr className="border-b border-gray-100 bg-slate-50 text-left text-[11px] font-extrabold uppercase tracking-wider text-graphite-600">
              <th className="px-3 py-2.5">Тема</th>
              {!plain && (
                <>
                  <th className="px-3 py-2.5 whitespace-nowrap">Открыли</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">Видео досмотрели</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">ДЗ сдали</th>
                  <th className="px-3 py-2.5 text-center whitespace-nowrap">Средний</th>
                  <th className="px-3 py-2.5 text-center whitespace-nowrap">Ждут</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod, mi) => (
              <Fragment key={mod.id}>
                <tr className="bg-slate-50/70">
                  <td colSpan={cols} className="px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-primary-600">
                    <span className="mr-1 tabular-nums">{mi + 1}.</span>
                    <span>{mod.title}</span>
                    <span className="ml-1 font-bold text-primary-400">· {pluralTopics(mod.topics.length)}</span>
                  </td>
                </tr>
                {mod.topics.map((topic, ti) => {
                  const st = stats?.byTopic[topic.id] ?? null
                  const expanded = open.has(topic.id)
                  const onRow = (e: MouseEvent<HTMLTableRowElement>) => {
                    if (plain) return
                    const t = e.target as HTMLElement
                    // Кнопки и ссылки в строке (название, тумблер, «ДЗ») делают своё.
                    if (t.closest('button, a, input, label') && !t.closest('[data-expand]')) return
                    toggle(topic.id)
                  }
                  return (
                    <Fragment key={topic.id}>
                      <tr
                        data-testid="stats-topic-row"
                        data-topic={topic.id}
                        onClick={onRow}
                        className={cn('border-b border-gray-100 align-middle', !plain && 'cursor-pointer hover:bg-slate-50/60', expanded && 'bg-slate-50/60')}
                      >
                        <td className="px-3 py-2.5">
                          <TopicTitle
                            topic={topic}
                            number={`${mi + 1}.${ti + 1}`}
                            expandable={!plain}
                            expanded={expanded}
                            legacy={legacyHw[topic.id]}
                            homeworkRows={homeworkStateByTopic[topic.id] ?? []}
                            onOpen={() => onOpenTopic(topic, mod.title)}
                            onOpenHomeworkTab={onOpenHomeworkTab}
                            onToggleOpen={v => onToggleTopicOpen(topic.id, v)}
                          />
                        </td>
                        {!plain && <TopicStatCells st={st} inClass={inClass} loading={loading} />}
                      </tr>
                      {expanded && !plain && (
                        <tr data-testid="stats-topic-detail" data-topic={topic.id}>
                          <td colSpan={cols} className="border-b border-gray-100 bg-slate-50/60 p-0">
                            <TopicStudentsDetail courseId={courseId} topicId={topic.id} period={period} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TopicTitle({ topic, number, expandable, expanded, legacy, homeworkRows, onOpen, onOpenHomeworkTab, onToggleOpen }: {
  topic: Topic
  number: string
  expandable: boolean
  expanded: boolean
  legacy: LegacyHomeworkCount | undefined
  homeworkRows: TopicHomeworkRow[]
  onOpen: () => void
  onOpenHomeworkTab: () => void
  onToggleOpen: (v: boolean) => Promise<void>
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      {expandable ? (
        <button
          type="button"
          data-expand
          aria-expanded={expanded}
          aria-label={expanded ? `Свернуть: ${topic.title}` : `Кто из учеников открыл, досмотрел и сдал: ${topic.title}`}
          className="-my-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-graphite-400 hover:bg-white hover:text-primary-600"
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      ) : null}
      <span className="shrink-0 pt-px text-xs tabular-nums text-graphite-500">{number}</span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="mr-1.5 text-left text-graphite-900 underline-offset-2 hover:text-primary-600 hover:underline"
          title="Открыть окно темы"
        >
          {topic.title}
        </button>
        <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
          <TopicKindMark kind={topic.kind} />
          <TopicOpenToggle topic={topic} onToggle={onToggleOpen} />
          <TopicHomeworkBadge rows={homeworkRows} />
          {legacy && (
            <button
              type="button"
              onClick={onOpenHomeworkTab}
              data-testid="topic-legacy-hw"
              title={`Задания ДЗ по шаблонам: шаблонов ${legacy.templateCount}, назначений ${legacy.assignmentCount}`}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-graphite-600 hover:bg-primary-50 hover:text-primary-700"
            >
              {legacy.templateCount} {plural(legacy.templateCount, 'шаблон', 'шаблона', 'шаблонов')} ДЗ
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

function TopicStatCells({ st, inClass, loading }: { st: TopicStats | null; inClass: number; loading?: boolean }) {
  if (!st) {
    return (
      <>
        {[0, 1, 2, 3, 4].map(i => (
          <td key={i} className={cn('px-3 py-2.5', i >= 3 && 'text-center')}>
            <Dash>{loading ? '…' : '—'}</Dash>
          </td>
        ))}
      </>
    )
  }
  return (
    <>
      <td className="px-3 py-2.5"><Meter part={st.opened} whole={inClass} testId="stat-opened" /></td>
      <td className="px-3 py-2.5" title={st.videos && st.videoStarted ? `начали, но не досмотрели: ${st.videoStarted}` : undefined}>
        {st.videos === 0 ? <Dash>нет видео</Dash> : <Meter part={st.videoDone} whole={inClass} testId="stat-video" />}
      </td>
      <td className="px-3 py-2.5">
        {st.timed ? <Dash title="Работа по времени — в разделе «Контрольные, самостоятельные и пробники»">в разделе выше</Dash>
          : !st.hw ? <Dash>нет ДЗ</Dash>
            : <Meter part={st.submitted} whole={inClass} testId="stat-hw" />}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums" data-testid="stat-avg">
        {st.avgScore === null ? <Dash /> : formatScore(st.avgScore, st.gradeScale)}
      </td>
      <td className="px-3 py-2.5 text-center" data-testid="stat-pending">
        {st.pending > 0
          ? <span className="rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700">{st.pending}</span>
          : <Dash />}
      </td>
    </>
  )
}

const MARK = {
  y: 'bg-verdict-ok-tint text-verdict-ok-ink',
  n: 'bg-verdict-none-tint text-verdict-none-ink',
  p: 'bg-verdict-part-tint text-verdict-part-ink',
  b: 'bg-verdict-bad-tint text-verdict-bad-ink',
  w: 'bg-gold-50 text-gold-700',
}
function Mark({ tone, children, title }: { tone: keyof typeof MARK; children: ReactNode; title: string }) {
  return (
    <span title={title} aria-label={title} className={cn('inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[11px] font-extrabold', MARK[tone])}>
      {children}
    </span>
  )
}

function hwMark(r: TopicStudentRow): { tone: keyof typeof MARK; text: string; title: string } {
  switch (r.hw) {
    case 'accepted': return { tone: 'y', text: r.score === null ? '✓' : String(r.score), title: r.score === null ? 'ДЗ принято' : `Оценка за ДЗ: ${r.score}${r.gradeScale === 'hundred' ? ' из 100' : ''}` }
    case 'submitted': return { tone: 'w', text: 'ждёт', title: 'ДЗ сдано, ждёт проверки' }
    case 'returned': return { tone: 'b', text: 'вернули', title: 'ДЗ вернули на доработку' }
    case 'draft': return { tone: 'p', text: 'начал', title: 'ДЗ начато, не сдано' }
    default: return { tone: 'n', text: '—', title: 'ДЗ не сдано' }
  }
}

function TopicStudentsDetail({ courseId, topicId, period }: { courseId: string; topicId: string; period: StatsPeriod }) {
  const { status, data } = useTopicStudentsStats(courseId, topicId, period)
  const hasVideo = !!data?.some(r => r.video !== null)
  return (
    // sticky + ширина экрана: на телефоне раскрытие не уезжает вправо вместе с
    // широкой таблицей, а стоит там, где его видно.
    <div className="sticky left-0 max-w-[calc(100vw-2.5rem)] px-3 py-3" data-testid="stats-topic-students">
      {status === 'error' && !data ? (
        <p className="text-[12.5px] text-verdict-bad-ink">Не удалось загрузить учеников темы.</p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-[12.5px] text-graphite-600"><Loader2 size={13} className="animate-spin" />Загружаем учеников…</p>
      ) : data.length === 0 ? (
        <p className="text-[12.5px] text-graphite-600">В классе пока нет учеников.</p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5">
            {data.map(r => {
              const hw = hwMark(r)
              return (
                <li key={r.studentId} data-testid="stats-topic-student" className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-1.5 text-[12.5px]">
                  <Link to={`/students/${r.studentId}?course=${courseId}`} className="min-w-0 flex-1 truncate text-graphite-900 hover:text-primary-600" title={r.fullName}>
                    {shortName(r.fullName)}
                  </Link>
                  <Mark tone={r.opened ? 'y' : 'n'} title={r.opened ? 'Открывал материалы темы' : 'Материалы темы не открывал'}>{r.opened ? 'О' : '—'}</Mark>
                  {r.video !== null && (
                    <Mark
                      tone={r.video === 'done' ? 'y' : r.video === 'started' ? 'p' : 'n'}
                      title={r.video === 'done' ? 'Досмотрел видео' : r.video === 'started' ? 'Начал видео, не досмотрел' : 'Видео не смотрел'}
                    >
                      {r.video === 'done' ? 'В' : r.video === 'started' ? '½' : '—'}
                    </Mark>
                  )}
                  <Mark tone={hw.tone} title={hw.title}>{hw.text}</Mark>
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-graphite-600">
            <span><Mark tone="y" title="открыл">О</Mark> открыл материалы</span>
            {hasVideo && <span><Mark tone="y" title="досмотрел">В</Mark> досмотрел видео · <Mark tone="p" title="начал">½</Mark> начал</span>}
            <span><Mark tone="y" title="оценка">5</Mark> оценка за ДЗ · <Mark tone="w" title="ждёт">ждёт</Mark> проверки · <Mark tone="n" title="нет">—</Mark> нет</span>
            {period !== 'all' && <span className="text-graphite-500">за {period === '7d' ? '7 дней' : '30 дней'}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ─── По ученикам ────────────────────────────────────────────────────────────

const STUDENT_COLS: { key: StudentSortKey; label: string; center?: boolean; title?: string }[] = [
  { key: 'name', label: 'Ученик' },
  { key: 'last', label: 'Был в курсе', title: 'Когда последний раз открывал материалы, смотрел видео или сдавал работу' },
  { key: 'days', label: 'Дней занятий', center: true, title: 'За выбранный период' },
  { key: 'files', label: 'Открыл файлов', center: true, title: 'Сколько разных файлов курса открыл из доступных ему — за всё время' },
  { key: 'video', label: 'Видео', center: true, title: 'Время просмотра за выбранный период' },
  { key: 'hw7', label: 'ДЗ за 7 дн.', center: true, title: 'Сдач ДЗ за последние 7 дней' },
  { key: 'hw30', label: 'ДЗ за 30 дн.', center: true, title: 'Сдач ДЗ за последние 30 дней' },
  { key: 'hw', label: 'ДЗ всего', title: 'Сдано из открытых тем с ДЗ' },
  { key: 'avg', label: 'Средний', center: true, title: 'Средний балл принятых ДЗ за выбранный период' },
  { key: 'debts', label: 'Долги', center: true, title: 'Открытые темы, где срок ДЗ прошёл, а сдачи нет' },
  { key: 'mock', label: 'Пробник', center: true, title: 'Вторичный балл последнего пробника с итогом' },
]

const TONE = { ok: 'text-verdict-ok-ink font-semibold', mid: 'text-gold-700 font-semibold', bad: 'text-verdict-bad-ink font-bold' }

export function StatsStudentsTable({ data, courseId, sort, onSort, loading }: {
  data: CourseStudentsStats
  courseId: string
  sort: StudentSort
  onSort: (s: StudentSort) => void
  loading?: boolean
}) {
  const navigate = useNavigate()
  const rows = useMemo(() => sortStudents(data.rows, sort, data.to), [data, sort])
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white" data-testid="stats-students" aria-busy={loading ? 'true' : undefined}>
      <div className="overflow-x-auto" data-testid="stats-students-scroll">
        <table className="w-full min-w-[1120px] text-[13.5px]">
          <thead>
            <tr className="border-b border-gray-100 bg-slate-50 text-left text-[11px] font-extrabold uppercase tracking-wider text-graphite-600">
              {STUDENT_COLS.map(c => (
                <th
                  key={c.key}
                  className={cn('px-3 py-2.5 whitespace-nowrap', c.center && 'text-center')}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button
                    type="button"
                    title={c.title}
                    data-sort={c.key}
                    onClick={() => onSort(nextSort(sort, c.key))}
                    className="font-extrabold uppercase tracking-wider hover:text-primary-700"
                  >
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={STUDENT_COLS.length} className="px-3 py-4 text-graphite-600">В классе пока нет учеников.</td></tr>
            )}
            {rows.map(r => {
              const ago = formatAgo(r.lastDay, data.to)
              const avg = pickAvg(r.avgFive, r.avgHundred)
              return (
                <tr
                  key={r.studentId}
                  data-testid="stats-student-row"
                  data-student={r.studentId}
                  onClick={e => { if (!(e.target as HTMLElement).closest('a')) navigate(`/students/${r.studentId}?course=${courseId}`) }}
                  className="cursor-pointer border-b border-gray-100 whitespace-nowrap hover:bg-slate-50/60"
                >
                  <td className="px-3 py-2.5 font-semibold">
                    <Link to={`/students/${r.studentId}?course=${courseId}`} className="text-graphite-900 hover:text-primary-600">{r.fullName}</Link>
                  </td>
                  <td className="px-3 py-2.5" data-testid="stat-last"><span className={TONE[ago.tone]}>{ago.text}</span></td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{r.days}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums" data-testid="stat-files">
                    {r.filesOpened} <span className="text-graphite-400">из {r.filesTotal}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{r.videoSeconds ? formatDuration(r.videoSeconds) : <Dash />}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{r.hw7 || <Dash>0</Dash>}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{r.hw30 || <Dash>0</Dash>}</td>
                  <td className="px-3 py-2.5">{r.hwTotal ? <Meter part={r.hwDone} whole={r.hwTotal} testId="stat-hw-total" /> : <Dash>нет ДЗ</Dash>}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{avg.value === null ? <Dash /> : formatScore(avg.value, avg.scale)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r.debts ? <span className="rounded-full bg-verdict-bad-tint px-2 py-0.5 text-xs font-bold text-verdict-bad-ink">{r.debts}</span> : <Dash />}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums" title={data.mock ? data.mock.title : undefined}>
                    {!data.mock ? <Dash /> : r.mockScore === null ? <Dash>не писал</Dash> : r.mockScore}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
