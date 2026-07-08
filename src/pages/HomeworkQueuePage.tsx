import { useState, useMemo } from 'react'
import { Inbox, Loader2, RefreshCw, Users, List } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useHomeworkQueue, type QueueBucket, type QueueMode } from '@/hooks/useHomeworkQueue'
import { QueueFilters } from '@/components/queue/QueueFilters'
import { QueueList } from '@/components/queue/QueueList'

const DEFAULT_ON: QueueBucket[] = ['urgent', 'revision', 'new']  // backlog выключен по умолчанию
const CHECKED_PAGE_SIZE = 50

export function HomeworkQueuePage() {
  const [mode, setMode] = useState<QueueMode>('pending')
  const [active, setActive] = useState<Set<QueueBucket>>(new Set(DEFAULT_ON))
  const [groupBy, setGroupBy] = useState<'group' | 'flat'>('flat')
  const [checkedLimit, setCheckedLimit] = useState(CHECKED_PAGE_SIZE)
  const { items, counts, loading, reload, hasMore } = useHomeworkQueue(mode, checkedLimit)

  function toggle(b: QueueBucket) {
    setActive(prev => {
      const next = new Set(prev)
      next.has(b) ? next.delete(b) : next.add(b)
      return next
    })
  }

  const filtered = useMemo(() => mode === 'pending'
    ? items.filter(i => i.bucket && active.has(i.bucket))
    : items, [items, active, mode])

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox size={24} className="text-primary-600" />
            Очередь задач
          </h1>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          {mode === 'pending' && (
            <button
              onClick={() => setGroupBy(g => g === 'flat' ? 'group' : 'flat')}
              className="min-h-11 flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              title="Переключить группировку"
            >
              {groupBy === 'flat' ? <Users size={15} /> : <List size={15} />}
              {groupBy === 'flat' ? 'По группам' : 'Списком'}
            </button>
          )}
          <button
            onClick={reload}
            className="w-11 h-11 flex items-center justify-center text-gray-400 border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-700 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('pending')}
          className={cn(
            'min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
            mode === 'pending' ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300',
          )}
        >
          На проверке {mode === 'pending' && <span className="ml-1.5 text-xs opacity-70">{counts.total}</span>}
        </button>
        <button
          type="button"
          onClick={() => { setMode('checked'); setCheckedLimit(CHECKED_PAGE_SIZE) }}
          className={cn(
            'min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition-colors',
            mode === 'checked' ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300',
          )}
        >
          Проверенные
        </button>
      </div>

      {mode === 'pending' && <QueueFilters active={active} onToggle={toggle} counts={counts} />}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <Loader2 size={20} className="animate-spin" />Загрузка очереди…
        </div>
      ) : (
        <div className="space-y-4">
          <QueueList
            items={filtered}
            groupBy={mode === 'pending' ? groupBy : 'flat'}
            emptyText={mode === 'pending' ? 'Очередь пуста — всё проверено 🎉' : 'Проверенных работ пока нет'}
          />
          {mode === 'checked' && hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setCheckedLimit(limit => limit + CHECKED_PAGE_SIZE)}
                className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                Показать ещё
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
