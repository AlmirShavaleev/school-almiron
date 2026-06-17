import { cn } from '@/utils/cn'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'indigo'
  trend?: { value: number; label: string }
  onClick?: () => void
}

const colorClasses = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
  indigo: 'bg-indigo-50 text-indigo-600',
}

export function StatCard({ title, value, subtitle, icon, color = 'blue', trend, onClick }: StatCardProps) {
  return (
    <div
      className={cn('bg-white rounded-xl border border-gray-100 shadow-sm p-6', onClick && 'cursor-pointer hover:border-gray-200 hover:shadow-md transition-all')}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500">{title}</span>
        {icon && (
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', colorClasses[color])}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      {trend && (
        <div className={cn('text-xs mt-2 font-medium', trend.value >= 0 ? 'text-green-600' : 'text-red-600')}>
          {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
        </div>
      )}
    </div>
  )
}
