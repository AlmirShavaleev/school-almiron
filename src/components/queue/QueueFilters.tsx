import { cn } from '@/utils/cn'
import type { QueueBucket, QueueCounts } from '@/hooks/useHomeworkQueue'

const TABS: { key: QueueBucket; label: string; dot: string; active: string }[] = [
  { key: 'urgent',   label: 'Срочные',     dot: 'bg-red-500',    active: 'border-red-300 bg-red-50 text-red-700' },
  { key: 'new',      label: 'Новые',       dot: 'bg-primary-500',   active: 'border-primary-300 bg-primary-50 text-primary-700' },
  { key: 'backlog',  label: 'Бэклог',      dot: 'bg-slate-400',   active: 'border-slate-300 bg-slate-100 text-slate-600' },
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
              'flex min-h-11 items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors',
              on ? t.active : 'bg-white/80 border-slate-200 text-slate-400 hover:border-primary-200'
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
