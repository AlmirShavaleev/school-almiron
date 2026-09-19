import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/utils/cn'

/**
 * Знак вопроса рядом с заголовком блока: по клику раскрывает пояснения (§207).
 *
 * Зачем. На экране проверки набралось четыре абзаца верных, но одинаковых
 * каждый раз объяснений — «рамки сохраняются сразу», «ИИ может ошибиться»,
 * «клик открывает место в работе». Преподаватель читает их один раз, а место
 * они занимают всегда, и из них складывается ощущение каши. Выбросить нельзя:
 * тексты правдивые и нужны новому человеку. Поэтому не удаление, а свёртка —
 * одна подсказка на блок.
 *
 * Раскрытие местное и не запоминается: подсказку открывают, чтобы что-то
 * уточнить сейчас, а не чтобы держать её открытой.
 */
export function HintNote({
  label,
  lines,
  testId = 'hint-note',
  className,
}: {
  /** Что именно поясняем — уходит в `aria-label` и в `title`. */
  label: string
  lines: readonly string[]
  testId?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const items = lines.filter(line => line && line.trim().length > 0)
  if (items.length === 0) return null

  return (
    <span className={cn('inline-flex min-w-0 flex-col', className)}>
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(value => !value)}
        className="inline-flex w-fit items-center justify-center rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <span
          data-testid={testId}
          className="mt-1 block space-y-1 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] leading-4 text-gray-600"
        >
          {items.map(line => <span key={line} className="block">{line}</span>)}
        </span>
      )}
    </span>
  )
}
