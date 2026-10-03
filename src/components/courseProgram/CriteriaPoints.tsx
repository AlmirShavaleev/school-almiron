import { AlertTriangle, Minus, Plus } from 'lucide-react'
import { CRITERIA_MISMATCH_LABEL } from '@/lib/aiHomeworkCheck'
import { pointsText, stepPoints } from '@/lib/homeworkReviewTasks'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'
import { fmt, type CriteriaGrade } from '../../../supabase/functions/check-homework-ai/points.ts'

/**
 * §260. Баллы по критериям учителя на экране проверки — по утверждённому
 * макету (`a260/maket.html`): сверху «9 из 12 баллов», оценка и таблица
 * перевода с подсвеченной строкой; у задания — «2 из 3» с кнопками ±.
 *
 * Сумму и оценку считает `gradeByCriteria` (тот же модуль, что у функции):
 * правка ± пересчитывает на экране ровно то, что посчитал бы сервер.
 */

/** Цвет оценки — тот же язык, что у вердиктов: 5/4 — зелёный, 3 — жёлтый, 2 — красный. */
function markTone(grade: number | null): string {
  if (grade == null) return 'bg-graphite-100 text-graphite-500'
  if (grade >= 4) return 'bg-verdict-ok-tint text-verdict-ok-ink'
  if (grade === 3) return 'bg-verdict-part-tint text-verdict-part-ink'
  return 'bg-verdict-bad-tint text-verdict-bad-ink'
}

/** «9 баллов», «2,5 балла» — склонение по целой части, дробное — «балла». */
function ballov(n: number): string {
  return Number.isInteger(n) ? plural(n, 'балла', 'баллов', 'баллов') : 'балла'
}

/**
 * Шапка: сумма, оценка, таблица перевода. При расхождении критериев — пометка
 * вместо оценки (функция её не подставила, и экран не подставляет тоже).
 *
 * `scale`: оценка печатается только по пятибалльной шкале — по стобалльной
 * рядом с суммой стоит процент, а таблица перевода остаётся справкой.
 */
export function CriteriaPointsHeader({
  grade,
  scale,
  mismatchReason,
  compact = false,
}: {
  grade: CriteriaGrade
  scale: 'five' | 'hundred' | null
  /** Что не сошлось — из разбора функции; '' — причина не прочиталась. */
  mismatchReason?: string | null
  /** Узкая колонка спокойного экрана: без таблицы перевода, одной строкой. */
  compact?: boolean
}) {
  const total = grade.total ?? 0
  const max = grade.max ?? 0
  const mismatch = grade.grading === 'criteria_mismatch'
  const showMark = scale === 'five' && grade.score != null
  // Подсвечивается строка, в которую попадает сумма (как `gradeFromTable`).
  const rows = [...(grade.gradeTable ?? [])].sort((a, b) => b.min - a.min)
  const hit = rows.find(row => row.min <= total)

  return (
    <div data-testid="criteria-points" data-grading={grade.grading ?? ''} className={cn(!compact && 'rounded-xl border border-graphite-200 bg-white')}>
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', !compact && 'px-3 py-2.5')}>
        <div className="flex items-baseline gap-1.5">
          <b data-testid="criteria-points-total" className={cn('font-extrabold tabular-nums text-graphite-900', compact ? 'text-[17px]' : 'text-[28px] leading-none')}>
            {fmt(total)}
          </b>
          <span className="text-sm text-graphite-500">
            из {fmt(max)} {ballov(max)}
            {scale === 'hundred' && grade.score != null && <> · {grade.score}%</>}
          </span>
        </div>
        {showMark && (
          <span
            data-testid="criteria-points-mark"
            aria-label={`Оценка ${grade.score}`}
            className={cn(
              'inline-grid place-items-center rounded-[10px] font-extrabold tabular-nums',
              compact ? 'h-7 w-7 text-base' : 'h-10 w-10 text-[22px]',
              markTone(grade.score),
            )}
          >
            {grade.score}
          </span>
        )}
        {!compact && rows.length > 0 && (
          <div data-testid="criteria-points-scale" aria-label="Перевод в оценку из критериев" className="flex flex-wrap gap-1.5 text-xs tabular-nums">
            {rows.map(row => {
              const on = !mismatch && row === hit
              return (
                <span
                  key={`${row.min}-${row.max}`}
                  data-testid="criteria-points-scale-row"
                  data-on={on ? 'true' : undefined}
                  className={cn(
                    'rounded-lg border px-2 py-0.5',
                    on ? 'border-verdict-ok bg-verdict-ok-tint font-bold text-verdict-ok-ink' : 'border-graphite-200 text-graphite-500',
                  )}
                >
                  {row.min === row.max ? row.min : `${row.min}–${row.max}`} → {row.grade}
                </span>
              )
            })}
          </div>
        )}
      </div>
      {mismatch ? (
        <p
          data-testid="criteria-points-mismatch"
          className={cn('flex items-start gap-1.5 rounded-lg bg-verdict-part-tint px-2.5 py-1.5 text-xs leading-5 text-verdict-part-ink', compact ? 'mt-1.5' : 'mx-3 mb-2.5')}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <b className="font-bold">{CRITERIA_MISMATCH_LABEL}</b>
            {mismatchReason ? `: ${mismatchReason}` : ''}. Оценка не подставлена — сверьте баллы с критериями.
          </span>
        </p>
      ) : !compact && (
        <p className="border-t border-graphite-200 px-3 py-1.5 text-xs text-graphite-500">
          {grade.grading === 'ratio'
            ? 'Баллы — из «Ответы и критерии». Таблицы перевода там нет: оценка по доле баллов (5 от 90 %, 4 от 70 %, 3 от 50 %).'
            : 'Баллы и таблица перевода — из «Ответы и критерии». Любой балл можно поправить кнопками ±.'}
          {grade.score == null && !mismatch && grade.grading === 'criteria' && ' Есть несверенные задания — оценка появится, когда у всех будет балл.'}
        </p>
      )}
    </div>
  )
}

/**
 * «− 2 из 3 +». Цвет числа — как у вердикта: полный балл зелёный, ноль
 * красный, между — жёлтый, «?» — не сверено.
 */
export function PointsStepper({
  no,
  points,
  max,
  onChange,
  disabled = false,
  size = 'sm',
}: {
  no: string
  points: number | null | undefined
  max: number
  onChange?: (points: number) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const tone = points == null
    ? 'text-verdict-unk-ink'
    : points >= max ? 'text-verdict-ok-ink' : points <= 0 ? 'text-verdict-bad-ink' : 'text-verdict-part-ink'
  const button = cn(
    'inline-grid shrink-0 place-items-center rounded-[7px] border border-graphite-200 bg-white text-graphite-900 transition-colors hover:border-graphite-300',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 disabled:opacity-40',
    size === 'md' ? 'h-8 w-8' : 'h-6 w-6',
  )
  const editable = onChange != null && !disabled
  return (
    <span data-testid="review-task-points" data-points={points ?? ''} data-max={max} className="inline-flex items-center gap-1" onClick={event => event.stopPropagation()}>
      {editable && (
        <button
          type="button"
          data-testid="review-task-points-minus"
          aria-label={`Задание ${no}: на балл меньше`}
          disabled={points != null && points <= 0}
          onClick={() => onChange(stepPoints(points, max, -1))}
          className={button}
        >
          <Minus size={size === 'md' ? 14 : 12} />
        </button>
      )}
      <span className={cn('min-w-[3.6em] whitespace-nowrap text-center font-extrabold tabular-nums', size === 'md' ? 'text-[15px]' : 'text-sm', tone)}>
        {pointsText(points, max)}
      </span>
      {editable && (
        <button
          type="button"
          data-testid="review-task-points-plus"
          aria-label={`Задание ${no}: на балл больше`}
          disabled={points != null && points >= max}
          onClick={() => onChange(stepPoints(points, max, 1))}
          className={button}
        >
          <Plus size={size === 'md' ? 14 : 12} />
        </button>
      )}
    </span>
  )
}
