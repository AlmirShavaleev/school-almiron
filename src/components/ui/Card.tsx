import { cn } from '@/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={cn(
        'platform-surface rounded-lg p-4 sm:p-6',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg active:translate-y-0',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-start justify-between gap-3 mb-4', className)}>{children}</div>
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn('font-semibold text-graphite-950 text-base tracking-tight', className)}>{children}</h3>
}
