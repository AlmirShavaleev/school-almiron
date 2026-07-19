import { useState } from 'react'
import { Users, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { QueueItem } from './QueueItem'
import type { QueueItem as QItem } from '@/hooks/useHomeworkQueue'

interface Props { items: QItem[]; groupBy: 'group' | 'flat'; emptyText?: string }

/** Группировка очереди: по группам или плоско. */
export function QueueList({ items, groupBy, emptyText }: Props) {
  if (items.length === 0) {
    return (
      <div className="platform-empty rounded-lg flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
        <Users size={36} className="opacity-25" />
        <p className="text-sm">{emptyText || 'Очередь пуста, всё проверено'}</p>
      </div>
    )
  }

  if (groupBy === 'flat') {
    return (
      <div className="space-y-2">
        {items.map(i => <QueueItem key={i.submissionId} item={i} />)}
      </div>
    )
  }

  // группировка по группам
  const byGroup: Record<string, { name: string; items: QItem[] }> = {}
  for (const i of items) {
    const groupId = i.group.id ?? 'ungrouped'
    const groupName = i.group.name ?? 'Без группы'
    if (!byGroup[groupId]) byGroup[groupId] = { name: groupName, items: [] }
    byGroup[groupId].items.push(i)
  }

  return (
    <div className="space-y-4">
      {Object.entries(byGroup).map(([gid, g]) => (
        <GroupSection key={gid} name={g.name} items={g.items} />
      ))}
    </div>
  )
}

function GroupSection({ name, items }: { name: string; items: QItem[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {name}
        <span className="min-w-5 h-5 px-1 inline-flex items-center justify-center rounded-full bg-white text-slate-500 text-xs ring-1 ring-slate-200">{items.length}</span>
      </button>
      {open && (
        <div className={cn('space-y-2')}>
          {items.map(i => <QueueItem key={i.submissionId} item={i} />)}
        </div>
      )}
    </div>
  )
}
