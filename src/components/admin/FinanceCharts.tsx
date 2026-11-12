import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { monthLabel, rub, type financeReport } from '@/lib/finance'
import './financeCharts.css'

type Report = ReturnType<typeof financeReport>
type Point = { label: string; [key: string]: string | number | null }
type Range = { key: string; label: string; points: Point[]; total: number; previous?: number; caption: string }
type Series = { key: string; name: string; color: string }
const BLUE = '#315af4', ORANGE = '#f28c28', GREY = '#9ba8c2'
const moneySeries: Series[] = [{ key: 'newRevenue', name: 'Новые оплаты', color: BLUE }, { key: 'renewRevenue', name: 'Продления', color: ORANGE }]
const countSeries: Series[] = [{ key: 'newCount', name: 'Новые', color: BLUE }, { key: 'renewCount', name: 'Продлили', color: ORANGE }, { key: 'notRenewed', name: 'Не продлили', color: GREY }]
const amount = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
const totalOf = (rows: { newRevenue: number; renewRevenue: number }[]) => rows.reduce((n, p) => n + Math.round((p.newRevenue + p.renewRevenue) * 100), 0) / 100
const change = (value: number, previous?: number) => previous != null && previous > 0 ? Math.round((value - previous) / previous * 100) : null

function TrendTooltip({ active, payload, label, money }: { active?: boolean; payload?: readonly { name?: string; value?: string | number; color?: string }[]; label?: React.ReactNode; money: boolean }) {
  if (!active || !payload?.length) return null
  return <div className="finance-trend-tooltip"><strong>{label}</strong>{payload.map(p => <div key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span><b>{money ? rub(Number(p.value)) : amount(Number(p.value))}</b></div>)}</div>
}

export function FinanceTrendCard({ title, ranges, series, defaultRange, money = true, note }: {
  title: string; ranges: Range[]; series: Series[]; defaultRange: string; money?: boolean; note?: string
}) {
  const [selected, setSelected] = useState(defaultRange)
  const id = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  const range = ranges.find(r => r.key === selected) ?? ranges[0]
  const delta = change(range.total, range.previous)
  const available = range.points.some(p => series.some(s => typeof p[s.key] === 'number' && Number(p[s.key]) !== 0))
  return <section className="finance-trend-card" aria-label={title} data-testid="finance-trend-card">
    <div className="finance-trend-top">
      <div className="min-w-0"><h2>{title}</h2><motion.div key={range.key} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}>
        <output className="finance-trend-value" aria-live="polite">{money ? rub(range.total) : amount(range.total)}</output>
      </motion.div></div>
      <span className={`finance-trend-delta ${delta == null ? 'is-neutral' : delta < 0 ? 'is-down' : 'is-up'}`} title={delta == null ? 'Нет предыдущего сопоставимого периода' : 'К предыдущему периоду. Текущий месяц может быть неполным.'}>
        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
      </span>
    </div>
    <p className="finance-trend-caption">{range.caption}{!available ? ' · нет оплат' : ''}</p>
    <div className="finance-trend-plot" role="img" aria-label={`${title}: ${money ? rub(range.total) : amount(range.total)}. ${range.caption}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={range.points} margin={{ top: 12, right: 10, bottom: 0, left: 4 }} accessibilityLayer>
          <defs>{series.map((s, i) => <linearGradient key={s.key} id={`${id}-area-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={.26} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
          <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={26} tick={{ fontSize: 11, fill: '#8290a9' }} dy={7} height={30} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip content={<TrendTooltip money={money} />} cursor={{ stroke: '#dbe3f5', strokeDasharray: '3 4' }} />
          {series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.7} fill={`url(#${id}-area-${i})`} dot={false} activeDot={{ r: 4, fill: s.color, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={!reduce} animationDuration={650} animationEasing="ease-out" />)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <div className="finance-trend-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    <div className="finance-trend-segments" role="group" aria-label={`Период: ${title}`}>
      {ranges.map(r => <button key={r.key} type="button" aria-pressed={range.key === r.key} onClick={() => setSelected(r.key)}>
        {range.key === r.key && <motion.span className="finance-trend-pill" layoutId={`${id}-pill`} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }} />}
        <span className="finance-trend-segment-label">{r.label}</span>
      </button>)}
    </div>
    {note && <p className="finance-trend-note">{note}</p>}
  </section>
}

export function FinanceCharts({ report, month }: { report: Report; month: string }) {
  const reduce = useReducedMotion()
  const monthlyRanges: Range[] = [3, 6, 12].map(n => {
    const rows = report.monthly.slice(-n), previous = report.monthly.slice(-n * 2, -n)
    return { key: String(n), label: n === 12 ? 'Год' : n === 6 ? '6 месяцев' : '3 месяца', points: rows.map(p => ({ ...p })), total: totalOf(rows), previous: previous.length === n ? totalOf(previous) : undefined, caption: `${rows[0]?.label ?? ''} — ${rows.at(-1)?.label ?? ''} · поступления` }
  })
  const dailyRows = report.daily.filter(p => p.amount !== null)
  const week = dailyRows.slice(-7), previousWeek = dailyRows.slice(-14, -7)
  const dailyTotal = (rows: typeof dailyRows) => rows.reduce((n, p) => n + Math.round((p.amount ?? 0) * 100), 0) / 100
  const dailyPoints = (rows: typeof dailyRows) => rows.map(p => ({ label: String(p.day), amount: p.amount }))
  const dayRanges: Range[] = [
    { key: 'week', label: 'Неделя', points: dailyPoints(week), total: dailyTotal(week), previous: week.length === 7 && previousWeek.length === 7 ? dailyTotal(previousWeek) : undefined, caption: `${week[0]?.day ?? '—'}–${week.at(-1)?.day ?? '—'} · ${monthLabel(month)}` },
    { key: 'month', label: 'Месяц', points: dailyPoints(report.daily), total: report.gross, previous: report.previous, caption: `${monthLabel(month)} · по дням` },
  ]
  const countRanges: Range[] = [3, 6, 12].map(n => {
    const rows = report.monthly.slice(-n), previous = report.monthly.slice(-n * 2, -n)
    const sum = (items: typeof rows) => items.reduce((a, p) => a + p.newCount + p.renewCount, 0)
    return { key: String(n), label: n === 12 ? 'Год' : n === 6 ? '6 месяцев' : '3 месяца', points: rows.map(p => ({ ...p })), total: sum(rows), previous: previous.length === n ? sum(previous) : undefined, caption: `${rows[0]?.label ?? ''} — ${rows.at(-1)?.label ?? ''} · оплаченных подписок` }
  })
  return <div className="space-y-5" data-testid="finance-charts">
    <div className="grid min-w-0 gap-5 lg:grid-cols-3"><div className="min-w-0 lg:col-span-2"><FinanceTrendCard title="Поступления по месяцам" ranges={monthlyRanges} series={moneySeries} defaultRange="6" /></div>
      <section className="finance-trend-card" aria-label="Поступления по курсам"><div className="finance-trend-top"><div><h2>Поступления по курсам</h2><output className="finance-trend-value">{rub(report.gross)}</output></div></div><p className="finance-trend-caption">{monthLabel(month)} · выбранные курсы</p><div className="finance-course-trends">{report.byCourse.map((c, i) => <div key={c.id}><div className="finance-course-trend-label"><span>{c.title}</span><b>{rub(c.amount)}</b></div><div className="finance-course-track"><motion.div initial={false} animate={{ width: `${report.gross ? c.amount / report.gross * 100 : 0}%` }} transition={{ duration: reduce ? 0 : .35 }} style={{ background: i % 2 ? ORANGE : BLUE }} /></div></div>)}</div></section>
    </div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-2"><FinanceTrendCard title="Поступления по дням" ranges={dayRanges} series={[{ key: 'amount', name: 'Поступления', color: BLUE }]} defaultRange="month" />
      <FinanceTrendCard title="Подписки по месяцам" ranges={countRanges} series={countSeries} defaultRange="6" money={false} note="Новые и продления — по подпискам на курсы. Не продлили — оплаченный период закончился без следующей оплаты к концу месяца; текущий месяц — на сегодня." /></div>
  </div>
}
