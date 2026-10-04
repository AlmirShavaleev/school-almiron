import { FIVE_GRADES } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

/**
 * §265. Оценка 5-балльной работы — четыре кнопки 2 · 3 · 4 · 5 вместо поля с
 * числом (макет «Шкалы оценок», вкладка Б). Ноль и единицу 5-балльной работе
 * не ставят — их нет и на экране, и сервер их не примет
 * (`topic_homework_reviews_scale_trg`).
 *
 * Цвет у нажатой — по смыслу оценки (2 — красная, 3 — охра, 4 — синяя,
 * 5 — зелёная), но не только цвет: нажатая ещё и залита, у неё
 * `aria-pressed`, а цифра остаётся цифрой.
 */
const PRESSED: Record<(typeof FIVE_GRADES)[number], string> = {
  2: 'border-verdict-bad bg-verdict-bad text-white',
  3: 'border-verdict-part bg-verdict-part text-white',
  4: 'border-primary-600 bg-primary-600 text-white',
  5: 'border-verdict-ok bg-verdict-ok text-white',
}

export function GradeButtons({
  value,
  onChange,
  disabled = false,
  size = 'lg',
  className,
}: {
  value: number | null
  onChange: (grade: number) => void
  disabled?: boolean
  /** `lg` — нижняя полоса экрана проверки (44 px), `md` — карточка ученика (40 px). */
  size?: 'lg' | 'md'
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Оценка"
      data-testid="review-grade-buttons"
      className={cn('flex shrink-0 gap-2', className)}
    >
      {FIVE_GRADES.map(grade => {
        const pressed = value === grade
        return (
          <button
            key={grade}
            type="button"
            data-testid={`review-grade-${grade}`}
            aria-pressed={pressed}
            aria-label={`Оценка ${grade}`}
            disabled={disabled}
            onClick={() => onChange(grade)}
            className={cn(
              'inline-flex items-center justify-center rounded-xl border-2 font-extrabold tabular-nums transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
              'disabled:cursor-not-allowed disabled:opacity-60',
              size === 'lg' ? 'h-11 w-11 text-xl' : 'h-10 w-10 text-lg',
              pressed ? PRESSED[grade] : 'border-graphite-200 bg-white text-graphite-900 hover:border-graphite-300',
            )}
          >
            {grade}
          </button>
        )
      })}
    </div>
  )
}
