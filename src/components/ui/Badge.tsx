import { cn } from '@/utils/cn'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'
  className?: string
}

const variantClasses = {
  default: 'bg-slate-100 text-slate-600 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-gold-50 text-gold-800 ring-gold-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-primary-50 text-primary-700 ring-primary-200',
  purple: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset', variantClasses[variant], className)}>
      {children}
    </span>
  )
}
