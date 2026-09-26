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

/*
 * §225. Плитка-KPI в этом шаге только перекрашена под v2: белая карточка,
 * цифра моноширинная, значок в мягкой заливке без обводки. Убирать плитки
 * (бриф: «без плиток-KPI») — дело шагов, которые перестраивают экраны.
 */
const colorClasses = {
  blue: 'bg-primary-50 text-primary-700',
  green: 'bg-verdict-ok-tint text-verdict-ok-ink',
  purple: 'bg-indigo-50 text-indigo-700',
  orange: 'bg-gold-100 text-gold-800',
  red: 'bg-verdict-bad-tint text-verdict-bad-ink',
  indigo: 'bg-sky-50 text-sky-700',
  gold: 'bg-gold-100 text-gold-800',
  slate: 'bg-graphite-100 text-graphite-700',
}

export function StatCard({ title, value, subtitle, icon, color = 'blue', trend, onClick }: StatCardProps) {
  return (
    <div
      className={cn(
        'min-w-0 platform-surface rounded-card p-4 sm:p-5',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(31,85,224,0.14)] active:translate-y-0'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="min-w-0 text-sm font-medium text-graphite-500 break-words">{title}</span>
        {icon && (
          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', colorClasses[color])}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight tabular-nums text-graphite-900 mb-1">{value}</div>
      {subtitle && <p className="text-xs font-medium text-graphite-500">{subtitle}</p>}
      {trend && (
        <div className={cn('text-xs mt-2 font-medium', trend.value >= 0 ? 'text-verdict-ok-ink' : 'text-verdict-bad-ink')}>
          {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
        </div>
      )}
    </div>
  )
}
