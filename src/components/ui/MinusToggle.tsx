import type { PointerEvent } from 'react'
import { cn } from '@/utils/cn'
import { hasLeadingMinus, toggleMinus } from '@/lib/answerSign'

/**
 * §267. Кнопка «±» рядом с полем числового ответа.
 *
 * На iPhone у цифровой клавиатуры нет минуса — эта кнопка его ставит/убирает.
 * `onPointerDown` + `preventDefault` не уводит фокус из поля: клавиатура
 * остаётся открытой, курсор — в конце ответа.
 */
export function MinusToggle({ value, onChange, getInput, disabled, className, testid = 'answer-minus' }: {
  value: string
  onChange: (next: string) => void
  /** Поле ответа: чтобы не терять фокус и поставить курсор в конец. */
  getInput?: () => HTMLInputElement | null
  disabled?: boolean
  className?: string
  testid?: string
}) {
  const negative = hasLeadingMinus(value)
  function keepFocus(e: PointerEvent<HTMLButtonElement>) {
    const el = getInput?.()
    if (el && document.activeElement === el) e.preventDefault()
  }
  function toggle() {
    const next = toggleMinus(value)
    onChange(next)
    const el = getInput?.()
    if (el && document.activeElement === el) {
      requestAnimationFrame(() => { try { el.setSelectionRange(next.length, next.length) } catch { /* type без выделения */ } })
    }
  }
  return (
    <button
      type="button"
      data-testid={testid}
      onPointerDown={keepFocus}
      onClick={toggle}
      disabled={disabled}
      aria-label={negative ? 'Убрать минус' : 'Поставить минус'}
      aria-pressed={negative}
      title="Минус: поставить или убрать"
      className={cn(
        'inline-flex h-10 min-w-[2.5rem] shrink-0 items-center justify-center rounded-xl border border-graphite-300 bg-white px-2 text-lg font-bold leading-none text-graphite-800',
        'hover:bg-graphite-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-50',
        negative && 'border-primary-400 bg-primary-50 text-primary-700',
        className,
      )}
    >
      ±
    </button>
  )
}
