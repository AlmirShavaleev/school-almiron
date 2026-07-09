import { cn } from '@/utils/cn'
import { forwardRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, ...props }, ref) => (
    <div className="w-full">
      {label && <label className="block text-sm font-semibold text-graphite-700 mb-1.5">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-graphite-950 placeholder-slate-400 shadow-sm shadow-slate-950/[0.02]',
            'transition-colors focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100',
            'disabled:bg-slate-50 disabled:text-slate-500',
            error && 'border-red-300 focus:border-red-300 focus:ring-red-100',
            icon && 'pl-10',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => (
    <div className="w-full">
      {label && <label className="block text-sm font-semibold text-graphite-700 mb-1.5">{label}</label>}
      <select
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-graphite-950 shadow-sm shadow-slate-950/[0.02]',
          'transition-colors focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100',
          error && 'border-red-300 focus:border-red-300 focus:ring-red-100',
          className
        )}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
)
Select.displayName = 'Select'
