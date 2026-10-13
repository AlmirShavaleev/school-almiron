/**
 * §290-B. Подтверждение в стиле платформы вместо `window.confirm()`.
 *
 * Нативный confirm блокировал автоматизацию браузера (тест 12.10) и выглядел
 * чужим. Здесь — модалка: Esc и «Отмена» закрывают, фокус — на главной
 * кнопке, пока идёт действие — кнопки заблокированы.
 */
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/Button'

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}: {
  open: boolean
  title: string
  text?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  testId?: string
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-graphite-950/40 p-4 sm:items-center"
      onClick={() => { if (!busy) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        className="w-full max-w-md rounded-card bg-white p-5 shadow-card sm:p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <h2 id={`${testId}-title`} className="text-[20px] font-semibold text-graphite-900">{title}</h2>
        {text && <p className="mt-2 text-[15px] text-graphite-700">{text}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={busy} data-testid={`${testId}-cancel`}>{cancelLabel}</Button>
          <Button
            ref={confirmRef}
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            data-testid={`${testId}-confirm`}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
