import { cn } from '@/utils/cn'
import type { QueueBucket, QueueCounts } from '@/hooks/useHomeworkQueue'

const TABS: { key: QueueBucket; label: string; dot: string; active: string }[] = [
  { key: 'urgent',   label: 'Срочные',     dot: 'bg-red-500',    active: 'border-red-300 bg-red-50 text-red-700' },
  { key: 'revision', label: 'На доработке', dot: 'bg-yellow-500', active: 'border-yellow-300 bg-yellow-50 text-yellow-700' },
  { key: 'new',      label: 'Новые',       dot: 'bg-blue-500',   active: 'border-blue-300 bg-blue-50 text-blue-700' },
  { key: 'backlog',  label: 'Бэклог',      dot: 'bg-gray-400',   active: 'border-gray-300 bg-gray-100 text-gray-600' },
]

export function QueueFilters({
  active, onToggle, counts,
}: {
  active: Set<QueueBucket>
  onToggle: (b: QueueBucket) => void
  counts: QueueCounts
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map(t => {
        const on = active.has(t.key)
        const n  = counts[t.key]
        return (
          <button
            key={t.key}
            onClick={() => onToggle(t.key)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors',
              on ? t.active : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
            )}
          >
            <span className={cn('w-2 h-2 rounded-full', t.dot, !on && 'opacity-40')} />
            {t.label}
            <span className={cn(
              'min-w-5 h-5 px-1 inline-flex items-center justify-center rounded-full text-xs font-semibold',
              on ? 'bg-white/70' : 'bg-gray-100 text-gray-500'
            )}>{n}</span>
          </button>
        )
      })}
    </div>
  )
}
