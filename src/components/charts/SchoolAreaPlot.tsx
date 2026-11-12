import { useId } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './schoolCharts.css'

/** Common presentation only: callers retain their own units, period and totals. */
export function SchoolAreaPlot({ points, title, color = '#315af4', animate = true, unit = 'событий' }: {
  points: { label: string; value: number | null }[]; title: string; color?: string; animate?: boolean; unit?: string
}) {
  const id = useId().replace(/:/g, '')
  const reduce = useReducedMotion()
  return <div className="school-chart-plot" role="img" aria-label={`${title}: ${points.map(p => `${p.label}: ${p.value ?? 'нет данных'}`).join('; ')}`}>
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -20 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.24} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={30} tick={{ fontSize: 11, fill: '#8995ac' }} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#8995ac' }} width={38} />
        <Tooltip cursor={{ stroke: '#cbd5ef', strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 16, border: '1px solid #e8edf8', fontSize: 12 }} />
        <Area type="monotone" dataKey="value" name={unit} stroke={color} strokeWidth={2.5} fill={`url(#${id})`} connectNulls={false} dot={points.length === 1} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 3 }} isAnimationActive={animate && !reduce} animationDuration={500} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
}
