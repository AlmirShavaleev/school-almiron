import { cn } from '@/utils/cn'
import { forwardRef, useId } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, id, ...props }, ref) => {
    // Подпись связана с полем через htmlFor/id. Пока связи не было, скринридер
    // называл поле «edit» без имени, а тесты по подписи молча врали:
    // queryByLabelText отдавал null независимо от того, есть поле на экране или
    // нет (урок §130). Свой id берём из useId, но переданный снаружи уважаем —
    // иначе сломались бы вызовы, где id уже используется для чего-то ещё.
    const generatedId = useId()
    const inputId = id ?? generatedId
    return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-[13px] font-medium text-graphite-900 mb-1.5">{label}</label>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            // §225. Поле v2: контур #c9d6ef в 1.5px, радиус 8, высота 48 на
            // телефоне и 40 на ноутбуке, текст 15 (на телефоне не мельче 13 —
            // и iOS не приближает страницу при фокусе, пока шрифт ≥ 16).
            'w-full min-h-12 sm:min-h-10 rounded-lg border-[1.5px] border-graphite-300 bg-white px-3 py-2 text-base sm:text-[15px] text-graphite-900 placeholder-graphite-400',
            'transition-colors focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-100',
            'disabled:bg-graphite-50 disabled:text-graphite-500',
            error && 'border-verdict-bad focus:border-verdict-bad focus:ring-red-100',
            icon && 'pl-10',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-verdict-bad-ink">{error}</p>}
    </div>
    )
  }
)
Input.displayName = 'Input'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    // Та же связь подписи с полем, что и у Input, — Select устроен так же.
    const generatedId = useId()
    const selectId = id ?? generatedId
    return (
    <div className="w-full">
      {label && <label htmlFor={selectId} className="block text-[13px] font-medium text-graphite-900 mb-1.5">{label}</label>}
      <select
        ref={ref}
        id={selectId}
        className={cn(
          'w-full min-h-12 sm:min-h-10 rounded-lg border-[1.5px] border-graphite-300 bg-white px-3 py-2 text-base sm:text-[15px] text-graphite-900',
          'transition-colors focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-100',
          error && 'border-verdict-bad focus:border-verdict-bad focus:ring-red-100',
          className
        )}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1.5 text-xs font-medium text-verdict-bad-ink">{error}</p>}
    </div>
    )
  }
)
Select.displayName = 'Select'
