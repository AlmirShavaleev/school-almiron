import { cn } from '@/utils/cn'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'indigo' | 'gold' | 'slate'
  trend?: { value: number; label: string }
  onClick?: () => void
}

const colorClasses = {
  blue: 'bg-primary-50 text-primary-700 ring-primary-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  purple: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  orange: 'bg-gold-50 text-gold-800 ring-gold-100',
  red: 'bg-red-50 text-red-700 ring-red-100',
  indigo: 'bg-sky-50 text-sky-700 ring-sky-100',
  gold: 'bg-gold-50 text-gold-800 ring-gold-100',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function StatCard({ title, value, subtitle, icon, color = 'blue', trend, onClick }: StatCardProps) {
  return (
    <div
      className={cn(
        'min-w-0 platform-surface rounded-lg p-4 sm:p-5',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg active:translate-y-0'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="min-w-0 text-sm font-semibold text-slate-500 break-words">{title}</span>
        {icon && (
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center ring-1 ring-inset', colorClasses[color])}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight text-graphite-950 mb-1">{value}</div>
      {subtitle && <p className="text-xs font-medium text-slate-500">{subtitle}</p>}
      {trend && (
        <div className={cn('text-xs mt-2 font-medium', trend.value >= 0 ? 'text-green-600' : 'text-red-600')}>
          {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
        </div>
      )}
    </div>
  )
}
