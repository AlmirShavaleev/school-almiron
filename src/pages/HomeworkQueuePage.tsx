import { useState, useMemo } from 'react'
import { Inbox, Loader2, RefreshCw, Users, List } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useHomeworkQueue, type QueueBucket } from '@/hooks/useHomeworkQueue'
import { QueueFilters } from '@/components/queue/QueueFilters'
import { QueueList } from '@/components/queue/QueueList'

const DEFAULT_ON: QueueBucket[] = ['urgent', 'revision', 'new']  // backlog выключен по умолчанию

export function HomeworkQueuePage() {
  const { items, counts, loading, reload } = useHomeworkQueue()
  const [active, setActive] = useState<Set<QueueBucket>>(new Set(DEFAULT_ON))
  const [groupBy, setGroupBy] = useState<'group' | 'flat'>('flat')

  function toggle(b: QueueBucket) {
    setActive(prev => {
      const next = new Set(prev)
      next.has(b) ? next.delete(b) : next.add(b)
      return next
    })
  }

  const filtered = useMemo(() => items.filter(i => active.has(i.bucket)), [items, active])

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox size={24} className="text-primary-600" />
            Очередь задач
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {counts.total === 0 ? 'Нет работ в очереди' : `${counts.total} работ ждут проверки`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setGroupBy(g => g === 'flat' ? 'group' : 'flat')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            title="Переключить группировку"
          >
            {groupBy === 'flat' ? <Users size={15} /> : <List size={15} />}
            {groupBy === 'flat' ? 'По группам' : 'Списком'}
          </button>
          <button
            onClick={reload}
            className="p-2 text-gray-400 border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <QueueFilters active={active} onToggle={toggle} counts={counts} />

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <Loader2 size={20} className="animate-spin" />Загрузка очереди…
        </div>
      ) : (
        <QueueList items={filtered} groupBy={groupBy} />
      )}
    </div>
  )
}
