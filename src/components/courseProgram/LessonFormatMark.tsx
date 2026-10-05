import { LESSON_FORMAT_LABEL, normalizeLessonFormat } from '@/lib/autocheck'
import { cn } from '@/utils/cn'

/**
 * §266. Пометка урока в списке уроков и в шапке урока, как в макете владельца:
 * «Тренировочный» — синяя, «Формат ЕГЭ» — охра. Урок без пометки (все курсы
 * до §266) — без метки: сорок одинаковых «Урок» в списке были бы шумом (как
 * у `TopicKindMark`). У проверочной и контрольной пометки нет — у них своя.
 */
export function LessonFormatMark({ format, kind, className }: { format: unknown; kind?: unknown; className?: string }) {
  const f = normalizeLessonFormat(format)
  if (!f) return null
  if (kind === 'check' || kind === 'control') return null
  return (
    <span
      data-testid="lesson-format-mark"
      data-format={f}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 align-middle text-[10.5px] font-extrabold uppercase tracking-[0.05em]',
        f === 'training' ? 'bg-primary-50 text-primary-700' : 'bg-gold-100 text-gold-800',
        className,
      )}
    >
      {LESSON_FORMAT_LABEL[f]}
    </span>
  )
}
