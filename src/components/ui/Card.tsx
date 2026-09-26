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
        // §225. Карточка v2: белая, радиус 20, мягкая синяя тень, без рамки
        // (`.platform-surface`). Кликабельная при наведении приподнимается.
        'platform-surface rounded-card p-4 sm:p-6',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(31,85,224,0.14)] active:translate-y-0',
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
