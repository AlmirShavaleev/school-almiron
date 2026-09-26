import { cn } from '@/utils/cn'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'
  className?: string
}

/*
 * §225. Метки v2: заливка без обводки (рамки вокруг мелочей — шум), текст —
 * тёмный оттенок той же краски, ≥ 4.5:1 на своей заливке. Успех, ошибка и
 * предупреждение взяты из красок состояний проверки — «верно», «неверно»,
 * «частично» по всему сайту одного цвета.
 */
const variantClasses = {
  default: 'bg-graphite-100 text-graphite-600',
  success: 'bg-verdict-ok-tint text-verdict-ok-ink',
  warning: 'bg-verdict-part-tint text-verdict-part-ink',
  error: 'bg-verdict-bad-tint text-verdict-bad-ink',
  info: 'bg-primary-50 text-primary-700',
  purple: 'bg-indigo-50 text-indigo-700',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums', variantClasses[variant], className)}>
      {children}
    </span>
  )
}
