import { CalendarClock, FileText } from 'lucide-react'
import { cn } from '@/utils/cn'
import { describeTopicHomework, type TopicHomeworkRow } from '@/lib/topicHomeworkState'

/**
 * Состояние ДЗ в строке темы (§117).
 *
 * Компактно намеренно: список тем бывает на 169 строк, и каждая лишняя деталь
 * умножается на это число. Поэтому одна плашка и, если есть, дата рядом —
 * без подписи «Дедлайн», без прочерков там, где данных нет.
 *
 * Правило состояний живёт в `lib/topicHomeworkState.ts` и проверено тестами;
 * здесь только оформление. Данные приходят пропсом — строка ничего не грузит.
 */
export function TopicHomeworkBadge({
  rows,
  className,
}: {
  /** Строки ДЗ этой темы из общего запроса по курсу. */
  rows: TopicHomeworkRow[]
  className?: string
}) {
  const info = describeTopicHomework(rows)

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)} data-testid="topic-homework-badge">
      <span
        data-testid={`topic-homework-state-${info.state}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap',
          info.state === 'published' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
          info.state === 'draft' && 'border-amber-200 bg-amber-50 text-amber-700',
          info.state === 'none' && 'border-gray-200 bg-gray-50 text-gray-400',
        )}
        title={
          info.state === 'draft'
            ? 'ДЗ создано, но не выдано ученикам'
            : info.state === 'published'
              ? 'ДЗ выдано ученикам'
              : 'У темы нет домашнего задания'
        }
      >
        <FileText size={10} className="shrink-0" />
        {info.label}
      </span>

      {/* Дедлайн только у опубликованного и только если он задан: пустое место
          честнее прочерка, который читается как «не загрузилось». */}
      {info.dueLabel && (
        <span
          data-testid="topic-homework-due"
          className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-gray-500"
        >
          <CalendarClock size={10} className="shrink-0" />
          {info.dueLabel}
        </span>
      )}
    </span>
  )
}
