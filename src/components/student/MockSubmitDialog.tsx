import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { formatLeftWords, mskTime } from '@/lib/mockExamLesson'
import { Send, X } from 'lucide-react'
import { cn } from '@/utils/cn'

/**
 * §229. «Сдать работу» — окно на весь экран (владелец: «у ученика внизу
 * выходит только кнопка — нужна модалка на весь экран»).
 *
 * §230. Было «листом снизу» на ~60 % экрана телефона — владелец: «на весь
 * экран». Теперь на телефоне — полноэкранный слой (белый, страница под ним не
 * видна, кнопки прижаты к низу), на ноутбуке — затемнение на весь экран и
 * крупная карточка по центру. Содержимое прежнее.
 *
 * Сколько осталось времени, что в бланке, сколько фото, какие номера пустые и
 * какие файлы не открылись (их преподаватель не увидит). Главная кнопка —
 * «Да, сдать работу»; фокус при открытии — на «Вернуться к работе» (сдача
 * необратима, безопасный выбор — первым), Tab ходит по кругу внутри окна,
 * Esc и системное «назад» (телефон: жест или кнопка) закрывают окно, а не
 * уводят со страницы; после закрытия фокус возвращается на кнопку «Сдать».
 */
const HISTORY_KEY = 'mockSubmitDialog'
/** Сколько окон сдачи смонтировано (StrictMode монтирует дважды) — свою запись истории снимает последнее. */
let openDialogs = 0
const ownHistoryEntry = () => !!(window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY]

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

  // §230. «Назад» закрывает окно: при открытии — своя запись в истории (адрес
  // тот же), «назад» снимает её, и мы закрываемся. Закрыли иначе (кнопка, Esc,
  // сдача) — свою запись убираем сами, чтобы следующее «назад» увело со
  // страницы, как обычно. Снятие — отложенное и только если окно не открылось
  // снова: в StrictMode эффект запускается дважды, и немедленный back()
  // первого запуска в Chrome уводил историю на запись раньше — окно
  // закрывалось, не успев открыться.
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useLayoutEffect(() => { closeRef.current = onClose; busyRef.current = busy })
  useEffect(() => {
    if (!open) return
    openDialogs++
    if (!ownHistoryEntry()) window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: true }, '')
    function onPop() {
      if (ownHistoryEntry()) return
      // Во время сдачи окно не закрываем — вернём свою запись.
      if (busyRef.current) { window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_KEY]: true }, ''); return }
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      openDialogs--
      setTimeout(() => { if (openDialogs === 0 && ownHistoryEntry()) window.history.back() }, 0)
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
      className="fixed inset-0 z-[70] flex bg-white sm:items-center sm:justify-center sm:bg-[rgba(14,31,71,.62)] sm:p-6"
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
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:max-w-[680px] sm:rounded-[28px] sm:shadow-[0_30px_80px_rgba(14,31,71,.35)]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4 pt-[max(20px,env(safe-area-inset-top))] sm:gap-5 sm:px-10 sm:pb-6 sm:pt-10">
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700 sm:h-14 sm:w-14" aria-hidden>
              <Send size={22} />
            </span>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Закрыть и вернуться к работе" data-testid="mock-lesson-submit-close"
              className="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-full text-graphite-500 hover:bg-graphite-100 hover:text-graphite-900 disabled:opacity-40 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-gold-300">
              <X size={22} aria-hidden />
            </button>
          </div>
          <h2 id="mock-submit-title" className="text-[26px] font-bold leading-tight text-graphite-900 [text-wrap:balance] sm:text-[32px]">{title}</h2>
          <p id="mock-submit-desc" className="text-base leading-snug text-graphite-600 sm:text-[17px]">
            {early ? `До конца ещё ${formatLeftWords(leftMs)}. ` : ''}После сдачи ответы изменить нельзя.
            {photosUntil ? ` Фото можно догрузить до ${mskTime(photosUntil)}.` : ''}
          </p>
          <ul className="flex flex-col gap-2.5 text-[17px] text-graphite-900 sm:text-lg" data-testid="mock-lesson-confirm-summary">
            <li className="flex items-center gap-3 rounded-2xl bg-primary-50 px-4 py-3">
              <VerdictMark state={filled === part1 ? 'ok' : filled > 0 ? 'part' : 'bad'} size={24} label={null} />
              Бланк: {filled} из {part1}
            </li>
            {part2Range && (
              <li className="flex items-center gap-3 rounded-2xl bg-primary-50 px-4 py-3">
                <VerdictMark state={photos > 0 ? 'ok' : 'none'} size={24} label={null} />
                Фото второй части: {photos > 0 ? photos : 'нет'}
              </li>
            )}
            {broken.map(b => (
              <li key={b.n} className="flex items-start gap-3 rounded-2xl bg-verdict-bad-tint px-4 py-3 text-base text-verdict-bad-ink" data-testid="mock-lesson-confirm-broken">
                <VerdictMark state="bad" size={24} label={null} />
                <span>{b.pdf ? `Файл ${b.n} (PDF) не открывается — загрузите его заново или пришлите фото страниц` : `Фото ${b.n} не открывается — переснимите или загрузите JPG`}</span>
              </li>
            ))}
          </ul>
          <div className={cn('rounded-2xl px-4 py-3 text-[15px] leading-snug', warnings ? 'bg-verdict-bad-tint text-verdict-bad-ink' : 'bg-verdict-ok-tint text-verdict-ok-ink')} data-testid="mock-lesson-confirm-note">
            {empty.length === 0 ? 'Пустых ответов нет.' : empty.length === 1
              ? `Пустой ответ №${empty[0]} засчитается как нерешённый.`
              : `Пустые ответы ${empty.map(n => `№${n}`).join(', ')} засчитаются как нерешённые.`}
            {part2Range && (photos === 0
              ? ` Фото второй части нет — номера ${part2Range} останутся без баллов.`
              : ` Номера ${part2Range} проверят по фото — убедитесь, что все листы сняты.`)}
          </div>
          {err && <p className="rounded-lg bg-verdict-bad-tint px-3 py-2 text-sm text-verdict-bad-ink" role="alert">{err}</p>}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-graphite-200 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 sm:flex-row-reverse sm:border-0 sm:px-10 sm:pb-10 sm:pt-2">
          <Button onClick={go} loading={busy} className="min-h-14 w-full text-base sm:flex-1" data-testid="mock-lesson-submit-yes">Да, сдать работу</Button>
          <Button ref={back} variant="secondary" onClick={onClose} disabled={busy} className="min-h-14 w-full text-base sm:flex-1" data-testid="mock-lesson-submit-back">Вернуться к работе</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
