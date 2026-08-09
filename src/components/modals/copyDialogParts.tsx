import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { describeDateMode, pluralDays, type CopyDateMode, type CopyProgress } from '@/lib/courseCopy'

/**
 * Общие детали двух диалогов копирования — курса и темы.
 *
 * Вынесено отдельно не ради экономии строк, а чтобы оба диалога говорили о
 * датах одними и теми же словами. Копирование курса и копирование темы —
 * одна операция в глазах преподавателя, и если в одном окне написано
 * «очистить сроки», а в другом «убрать даты», он будет думать, что это
 * разные вещи.
 */

/** Рамка модального окна: фон, крестик, заголовок, подвал с кнопками. */
export function CopyModalFrame({
  open, onClose, title, subtitle, children, footer, busy, testId,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer: ReactNode
  /** Пока идёт копирование, окно не закрывается ни по фону, ни по Esc. */
  busy?: boolean
  testId: string
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open || busy) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!busy) onClose() }} />
      <div
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-bold leading-tight text-gray-900">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-xs text-gray-400">{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            disabled={busy}
            className="ml-3 shrink-0 p-1 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>

        <div className="shrink-0 border-t border-gray-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  )
}

/**
 * Выбор того, что делать с датами.
 *
 * Сдвиг задаётся не числом дней, а новой датой: преподаватель знает, что курс
 * стартует 1 сентября, а не что его надо сдвинуть на 358 дней. Число дней
 * считается из двух дат и показывается подписью — чтобы было видно, что
 * именно произойдёт с остальными сроками.
 */
export function CopyDateModeField({
  mode, onModeChange, anchorDate, anchorLabel, newDate, onNewDateChange, shiftDays, disabled,
}: {
  mode: CopyDateMode
  onModeChange: (m: CopyDateMode) => void
  /** Дата оригинала, от которой считается сдвиг. null — сдвигать не от чего. */
  anchorDate: string | null
  /** Подпись поля с новой датой, например «Новая дата старта». */
  anchorLabel: string
  newDate: string
  onNewDateChange: (v: string) => void
  shiftDays: number
  disabled?: boolean
}) {
  const canShift = !!anchorDate

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-1.5 block text-sm font-semibold text-graphite-700">Сроки и даты</legend>

      <DateModeOption
        checked={mode === 'clear'}
        onSelect={() => onModeChange('clear')}
        title="Очистить"
        hint="Сроки сдачи и даты открытия будут пустыми — расставите заново"
      />
      <DateModeOption
        checked={mode === 'keep'}
        onSelect={() => onModeChange('keep')}
        title="Оставить как есть"
        hint="Все даты перенесутся без изменений"
      />
      <DateModeOption
        checked={mode === 'shift'}
        onSelect={() => onModeChange('shift')}
        disabled={!canShift}
        title="Сдвинуть на новый учебный год"
        hint={canShift
          ? 'Укажите новую дату — остальные сроки сдвинутся на столько же'
          : `Недоступно: у оригинала не заполнено поле «${anchorLabel.toLowerCase()}», сдвигать не от чего`}
      >
        {mode === 'shift' && canShift && (
          <div className="mt-3 space-y-1.5">
            <label className="block text-xs font-semibold text-graphite-700" htmlFor="copy-new-date">
              {anchorLabel}
            </label>
            <input
              id="copy-new-date"
              type="date"
              value={newDate}
              onChange={e => onNewDateChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-graphite-950 focus:border-primary-300 focus:outline-none focus:ring-4 focus:ring-primary-100"
            />
            <p className="text-xs text-gray-500">
              Было {formatRuDate(anchorDate)} · сдвиг {shiftDays === 0 ? 'нулевой' : `${Math.abs(shiftDays)} ${pluralDays(Math.abs(shiftDays))}`}
            </p>
          </div>
        )}
      </DateModeOption>

      <p data-testid="copy-date-summary" className="pt-1 text-xs text-gray-500">
        {describeDateMode(mode, shiftDays)}
      </p>
    </fieldset>
  )
}

function DateModeOption({
  checked, onSelect, title, hint, disabled, children,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  hint: string
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <label
      className={[
        'block cursor-pointer rounded-xl border px-3 py-2.5 transition-colors',
        checked ? 'border-primary-300 bg-primary-50/50' : 'border-gray-200 hover:border-gray-300',
        disabled ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <span className="flex items-start gap-2.5">
        <input
          type="radio"
          name="copy-date-mode"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900">{title}</span>
          <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>
        </span>
      </span>
      {children}
    </label>
  )
}

/**
 * Полоса прогресса копирования файлов.
 *
 * Показываем счётчик, а не крутилку: у курса с материалами файлов бывают
 * десятки, копирование идёт по одному, и без числа это выглядит как зависание.
 */
export function CopyProgressBar({ progress }: { progress: CopyProgress }) {
  const pct = progress.total === 0 ? 100 : Math.round((progress.copied / progress.total) * 100)
  // С §101 копия ссылается на те же объекты хранилища и файлов к переносу нет
  // вовсе: счётчик «0 из 0» врал бы о работе, которой не происходит.
  const nothingToCopy = progress.total === 0
  return (
    <div className="space-y-1.5" data-testid="copy-progress">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{nothingToCopy ? 'Собираю копию' : 'Копирую файлы материалов'}</span>
        {!nothingToCopy && (
          <span className="tabular-nums">{progress.copied} из {progress.total}</span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Что переносится, а что нет. Одинаковый текст в обоих диалогах. */
export function CopyScopeNote({ kind }: { kind: 'course' | 'topic' }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
      <p>
        <span className="font-semibold text-gray-700">Перенесётся:</span>{' '}
        {kind === 'course'
          ? 'модули и темы, все материалы (включая скрытые), домашние задания с приложенными файлами, привязанные тесты.'
          : 'материалы темы (включая скрытые), домашние задания с приложенными файлами, привязанные тесты.'}
      </p>
      <p className="mt-1.5">
        <span className="font-semibold text-gray-700">Не перенесётся:</span>{' '}
        {kind === 'course'
          ? 'ученики, заявки на вступление и ссылка-приглашение — у копии она будет своя.'
          : 'сданные работы и оценки учеников.'}
      </p>
      <p className="mt-1.5 text-gray-500">
        {kind === 'course'
          ? 'Копия создаётся черновиком и скрыта от учеников, пока вы её не опубликуете.'
          : 'Домашние задания в копии будут неопубликованными — ученики их не увидят, пока не откроете.'}
      </p>
      <p className="mt-1.5 text-gray-500">Оригинал остаётся на месте, его ничто не меняет.</p>
    </div>
  )
}

function formatRuDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
