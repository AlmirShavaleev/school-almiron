import { Clock } from 'lucide-react'
import { TOPIC_KIND_LABEL, isTimedKind, normalizeTopicKind } from '@/lib/timedWork'
import { cn } from '@/utils/cn'

/**
 * §240. Метка типа темы в программе курса: «⏱ Контрольная работа» /
 * «⏱ Проверочная работа». У урока метки нет — это обычная тема, и сорок
 * одинаковых «Урок» в списке были бы шумом.
 */
export function TopicKindMark({ kind, className }: { kind: unknown; className?: string }) {
  if (!isTimedKind(kind)) return null
  const k = normalizeTopicKind(kind)
  return (
    <span
      data-testid="topic-kind-mark"
      data-kind={k}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-extrabold',
        k === 'control' ? 'bg-primary-900 text-white' : 'bg-primary-100 text-primary-800',
        className,
      )}
    >
      <Clock size={10} className="shrink-0" aria-hidden />
      {TOPIC_KIND_LABEL[k]}
    </span>
  )
}
