import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { formatLeftWords, mskTime } from '@/lib/mockExamLesson'
import { cn } from '@/utils/cn'

/**
 * §229. «Сдать работу» — окно на весь экран (владелец: «у ученика внизу
 * выходит только кнопка — нужна модалка на весь экран»). На телефоне — лист
 * снизу во всю ширину, на ноутбуке — диалог по центру с затемнением.
 *
 * Сколько осталось времени, что в бланке, сколько фото, какие номера пустые и
 * какие файлы не открылись (их преподаватель не увидит). Главная кнопка —
 * «Да, сдать работу»; фокус при открытии — на «Вернуться к работе» (сдача
 * необратима, безопасный выбор — первым), Tab ходит по кругу внутри окна,
 * Esc закрывает, после закрытия фокус возвращается на кнопку «Сдать».
 */
export function MockSubmitDialog({ open, onClose, onConfirm, leftMs, photosUntil, part1, filled, empty, photos, broken, part2Range }: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<{ error: string | null }>
  /** Сколько осталось писать, по часам базы. */
  leftMs: number
  photosUntil: string | null
  part1: number
  filled: number
  empty: number[]
  photos: number
  /** Номера (с 1) фото/файлов, которые не открылись. */
  broken: { n: number; pdf: boolean }[]
  /** «13–19» — номера второй части; null — второй части нет. */
  part2Range: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    back.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [open])

  if (!open) return null
  const early = leftMs > 60_000
  const title = early ? 'Закончить пробник раньше времени?' : 'Сдать работу?'
  const warnings = empty.length > 0 || (part2Range && photos === 0) || broken.length > 0

  async function go() {
    setBusy(true)
    const r = await onConfirm()
    setBusy(false)
    if (r.error) setErr(r.error)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !box.current) return
    const focusables = Array.from(box.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(14,31,71,.55)] p-3 sm:items-center sm:p-6"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      data-testid="mock-lesson-dialog-scrim"
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-submit-title"
        aria-describedby="mock-submit-desc"
        onKeyDown={onKeyDown}
        data-testid="mock-lesson-confirm"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[520px] flex-col gap-3 overflow-y-auto rounded-[24px] bg-white px-[18px] pb-5 pt-5 shadow-[0_20px_50px_rgba(18,35,74,.25)] sm:px-6"
      >
        <h2 id="mock-submit-title" className="text-[21px] font-bold leading-tight text-graphite-900 [text-wrap:balance]">{title}</h2>
        <p id="mock-submit-desc" className="text-sm text-graphite-600">
          {early ? `До конца ещё ${formatLeftWords(leftMs)}. ` : ''}После сдачи ответы изменить нельзя.
          {photosUntil ? ` Фото можно догрузить до ${mskTime(photosUntil)}.` : ''}
        </p>
        <ul className="flex flex-col gap-2 text-[15px] text-graphite-900" data-testid="mock-lesson-confirm-summary">
          <li className="flex items-center gap-2">
            <VerdictMark state={filled === part1 ? 'ok' : filled > 0 ? 'part' : 'bad'} size={20} label={null} />
            Бланк: {filled} из {part1}
          </li>
          {part2Range && (
            <li className="flex items-center gap-2">
              <VerdictMark state={photos > 0 ? 'ok' : 'none'} size={20} label={null} />
              Фото второй части: {photos > 0 ? photos : 'нет'}
            </li>
          )}
          {broken.map(b => (
            <li key={b.n} className="flex items-start gap-2 text-verdict-bad-ink" data-testid="mock-lesson-confirm-broken">
              <VerdictMark state="bad" size={20} label={null} />
              <span>{b.pdf ? `Файл ${b.n} (PDF) не открывается — загрузите его заново или пришлите фото страниц` : `Фото ${b.n} не открывается — переснимите или загрузите JPG`}</span>
            </li>
          ))}
        </ul>
        <div className={cn('rounded-[10px] px-3 py-2.5 text-[13px] leading-snug', warnings ? 'bg-verdict-bad-tint text-verdict-bad-ink' : 'bg-primary-50 text-graphite-800')} data-testid="mock-lesson-confirm-note">
          {empty.length === 0 ? 'Пустых ответов нет.' : empty.length === 1
            ? `Пустой ответ №${empty[0]} засчитается как нерешённый.`
            : `Пустые ответы ${empty.map(n => `№${n}`).join(', ')} засчитаются как нерешённые.`}
          {part2Range && (photos === 0
            ? ` Фото второй части нет — номера ${part2Range} останутся без баллов.`
            : ` Номера ${part2Range} проверят по фото — убедитесь, что все листы сняты.`)}
        </div>
        {err && <p className="rounded-lg bg-verdict-bad-tint px-3 py-2 text-sm text-verdict-bad-ink" role="alert">{err}</p>}
        <Button onClick={go} loading={busy} className="min-h-12 w-full" data-testid="mock-lesson-submit-yes">Да, сдать работу</Button>
        <Button ref={back} variant="secondary" onClick={onClose} disabled={busy} className="min-h-12 w-full" data-testid="mock-lesson-submit-back">Вернуться к работе</Button>
      </div>
    </div>,
    document.body,
  )
}
