import type { ReactNode } from 'react'
import { SchoolAreaPlot } from '@/components/charts/SchoolAreaPlot'
import type { TeacherActivityDays, TeacherActivitySeries } from '@/hooks/useTeacherActivity'

const metrics = {
  visits: { title: 'Заходы на платформу', unit: 'Заходов', color: '#315af4' },
  submissions: { title: 'Сдачи домашних работ', unit: 'Сдач', color: '#d96b13' },
}

const daysFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthsFormat = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const rangeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})
const totalFormat = new Intl.NumberFormat('ru-RU')
const firstVisitDay = '2026-08-04'
const date = (day: string) => new Date(`${day}T00:00:00Z`)

export function TeacherActivityChart({ metric, days, series, children }: {
  metric: keyof typeof metrics
  days: TeacherActivityDays
  series: TeacherActivitySeries | null | undefined
  children?: ReactNode
}) {
  const { title, unit, color } = metrics[metric]
  const id = `teacher-card-${metric}`
  const points = series?.[metric] ?? []
  const total = points.reduce((sum, point) => sum + point.value, 0)
  const annual = days === 365
  const format = annual ? monthsFormat : daysFormat
  const plot = points.map(point => {
    const beforeTracking = metric === 'visits' && (annual
      ? point.day.slice(0, 7) < firstVisitDay.slice(0, 7)
      : point.day < firstVisitDay)
    return { label: format.format(date(point.day)), value: beforeTracking ? null : point.value }
  })

  return (
    <section className="school-chart-card" aria-labelledby={`${id}-title`} data-testid={id}>
      <h3 id={`${id}-title`} className="text-sm font-semibold text-graphite-700">{title}</h3>
      <span className="school-chart-value" data-testid={`${id}-value`}>{series ? totalFormat.format(total) : '—'}</span>
      {series && (
        <p className="text-xs text-graphite-600">
          {rangeFormat.formatRange(date(series.startsOn), date(series.endsOn))}
        </p>
      )}
      <div className="mt-2 min-h-6 text-xs text-graphite-600">
        {metric === 'visits' ? 'Один заход на ученика в день' : children}
      </div>
      {plot.length > 0 && <SchoolAreaPlot
        points={plot} title={`${title} ${annual ? 'по месяцам' : 'по дням'}`} color={color} unit={unit} animate={false}
      />}
      {metric === 'visits' && series && series.startsOn < firstVisitDay && (
        <p className="mt-2 text-xs text-graphite-600">Учёт заходов начался 4 августа 2026 года.</p>
      )}
    </section>
  )
}
