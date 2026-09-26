import { cn } from '@/utils/cn'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

/*
 * §225. Кнопки дизайн-системы v2.
 *
 * - primary — главное действие, одно на экран: синяя «таблетка» с градиентом
 *   и мягкой синей тенью. Недоступная — ровная светло-серая, без градиента,
 *   чтобы её не принимали за нажимаемую.
 * - secondary — белая в контуре поля (#c9d6ef), при наведении контур синий.
 * - ghost — тихая, текстом.
 * - danger / success — прежние смыслы, та же форма «таблетки».
 *
 * Высота 48 на телефоне и 40 с `sm` (ноутбук) — `min-h`, а не `h`: длинная
 * подпись переносится, а не обрезается.
 */
const variantClasses = {
  primary: 'bg-gradient-to-br from-action-from to-action-to text-white font-bold shadow-action hover:brightness-110 disabled:bg-none disabled:bg-graphite-200 disabled:text-graphite-500 disabled:shadow-none disabled:opacity-100',
  secondary: 'bg-white text-graphite-900 font-medium border-[1.5px] border-graphite-300 hover:border-primary-500',
  ghost: 'text-graphite-900 font-medium hover:bg-primary-50',
  danger: 'bg-red-600 text-white font-semibold hover:bg-red-700 shadow-sm shadow-red-900/10',
  success: 'bg-emerald-600 text-white font-semibold hover:bg-emerald-700 shadow-sm shadow-emerald-900/10',
}

const sizeClasses = {
  sm: 'min-h-11 sm:min-h-8 px-3.5 py-1 text-sm',
  md: 'min-h-12 sm:min-h-10 px-[18px] py-1.5 text-sm',
  lg: 'min-h-12 px-6 py-2 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
        'active:translate-y-px',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  )
)
Button.displayName = 'Button'
