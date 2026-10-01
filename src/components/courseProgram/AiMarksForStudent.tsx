import { RotateCcw, X } from 'lucide-react'
import type { AiFindingRow } from '@/lib/aiHomeworkCheck'
import {
  aiMarkDropLabel, aiMarksToggleLabel, hasEligibleAiMarks, type AiMarkItem, type AiMarksPlan,
} from '@/lib/aiMarksForStudent'
import { cn } from '@/utils/cn'

/**
 * §252. Строка над «Принять» / «Вернуть»: ☑ «Показать ученику N пометок ИИ
 * (№4, №5)», «посмотреть на фото» и подсказка. Галочка включена сразу
 * (решение владельца 01.10), строки нет вовсе, если подходящих находок нет —
 * тогда и решать нечего.
 */
export function AiMarksToggle({
  plan, checked, onCheckedChange, highlighted, onHighlightChange, disabled = false,
}: {
  plan: AiMarksPlan<AiFindingRow>
  checked: boolean
  onCheckedChange: (value: boolean) => void
  highlighted: boolean
  onHighlightChange: (value: boolean) => void
  disabled?: boolean
}) {
  if (!hasEligibleAiMarks(plan)) return null
  const count = plan.chosen.length
  return (
    <div
      data-testid="ai-marks-toggle"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-primary-50 px-3 py-2 text-[13px] text-graphite-900"
    >
      <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 font-bold">
        <input
          type="checkbox"
          data-testid="ai-marks-checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onCheckedChange(event.target.checked)}
          className="h-[18px] w-[18px] shrink-0 accent-primary-600"
        />
        <span data-testid="ai-marks-label" className="min-w-0">{aiMarksToggleLabel(plan.chosen)}</span>
      </label>
      {count > 0 && (
        <button
          type="button"
          data-testid="ai-marks-look"
          aria-pressed={highlighted}
          onClick={() => onHighlightChange(!highlighted)}
          className="font-extrabold text-primary-700 hover:text-primary-800"
        >
          {highlighted ? 'скрыть подсветку' : 'посмотреть на фото'}
        </button>
      )}
      {/* На телефоне подсказки нет: полоса внизу и так в треть экрана, а список — сразу под заданием. */}
      <small className="hidden text-xs text-graphite-500 sm:inline">
        по «неверно» и «частично»; лишнюю уберите крестиком в списке<span className="hidden lg:inline"> справа</span>
      </small>
    </div>
  )
}

/**
 * §252. Список «Пометки ИИ, которые увидит ученик» — в колонке заданий под
 * текущим заданием (на телефоне — под ним же, колонка одна). Решено держать
 * здесь, а не в «Все задания таблицей»: крестик нужен ДО вердикта, а лист с
 * таблицей открывают редко — спрятанный там список учитель бы не увидел.
 *
 * Номер — кнопка: переводит к заданию, фото докручивается к месту находки.
 * Ниже серым — то, что не уйдёт, с причиной («вы отметили «верно»»).
 */
export function AiMarksList({
  plan, enabled, ownNotes, onRemove, onRestore, onGoTask,
}: {
  plan: AiMarksPlan<AiFindingRow>
  /** Галочка над вердиктом: снята — ничего не уйдёт, список честно говорит об этом. */
  enabled: boolean
  /** Сколько пометок учителя уже на фото (свои и взятые) — уйдут как обычно. */
  ownNotes: number
  onRemove: (findingId: string) => void
  onRestore: (findingId: string) => void
  onGoTask?: (no: string) => void
}) {
  if (!hasEligibleAiMarks(plan) && plan.dropped.length === 0) return null
  const line = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-[10px] border px-2.5 py-2 text-[13px] leading-snug'
  const number = (item: AiMarkItem<AiFindingRow>) => item.taskNo ? (
    onGoTask
      ? (
        <button
          type="button"
          data-testid="ai-marks-go"
          onClick={() => onGoTask(item.taskNo!)}
          className="font-extrabold tabular-nums text-graphite-900 hover:text-primary-700"
          title={`К заданию ${item.taskNo}`}
        >
          №{item.taskNo}
        </button>
      )
      : <b className="font-extrabold tabular-nums">№{item.taskNo}</b>
  ) : <b className="font-extrabold text-graphite-400">—</b>

  return (
    <section data-testid="ai-marks-list" aria-label="Пометки ИИ, которые увидит ученик" className="space-y-2 border-t border-graphite-200 pt-3">
      <div>
        <h4 className="text-[14px] font-extrabold text-graphite-900">Пометки ИИ, которые увидит ученик</h4>
        <p className="text-xs text-graphite-500">
          {enabled
            ? 'Только по заданиям «неверно» и «частично». Уйдут при вердикте.'
            : 'Галочка «Показать ученику» снята — при вердикте ничего из этого не уйдёт.'}
        </p>
      </div>
      <ul className={cn('grid gap-1.5', !enabled && 'opacity-60')}>
        {plan.eligible.map(({ removed: off, ...item }) => (
          <li
            key={item.finding.id}
            data-testid="ai-marks-item"
            data-finding-id={item.finding.id}
            data-state={off ? 'removed' : 'chosen'}
            className={cn(line, 'border-graphite-200 bg-white')}
          >
            {number(item)}
            <span className={cn('min-w-0 break-words', off && 'text-graphite-400 line-through')}>{item.finding.text}</span>
            <button
              type="button"
              data-testid={off ? 'ai-marks-restore' : 'ai-marks-remove'}
              onClick={() => (off ? onRestore(item.finding.id) : onRemove(item.finding.id))}
              aria-label={`${off ? 'Вернуть' : 'Убрать'} пометку${item.taskNo ? ` №${item.taskNo}` : ''}`}
              title={off ? 'Вернуть — уйдёт ученику' : 'Убрать — ученику не уйдёт'}
              className="rounded-md p-0.5 text-graphite-400 transition-colors hover:bg-graphite-100 hover:text-graphite-900"
            >
              {off ? <RotateCcw size={14} /> : <X size={14} />}
            </button>
          </li>
        ))}
        {plan.dropped.map(item => (
          <li
            key={item.finding.id}
            data-testid="ai-marks-dropped"
            data-finding-id={item.finding.id}
            data-reason={item.reason}
            title={item.finding.text}
            className={cn(line, 'border-graphite-100 bg-graphite-50 text-graphite-500')}
          >
            {number(item)}
            <span className="min-w-0 break-words">{aiMarkDropLabel(item)}</span>
            <span />
          </li>
        ))}
      </ul>
      {ownNotes > 0 && (
        <p data-testid="ai-marks-own" className="text-xs text-graphite-500">
          Ваши пометки на фото ({ownNotes}) уйдут ученику как обычно.
        </p>
      )}
    </section>
  )
}
