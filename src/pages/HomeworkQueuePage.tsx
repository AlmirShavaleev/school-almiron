import { useState, useMemo } from 'react'
import { Inbox, Loader2, RefreshCw, Users, List } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useHomeworkQueue, type QueueBucket, type QueueMode } from '@/hooks/useHomeworkQueue'
import { QueueFilters } from '@/components/queue/QueueFilters'
import { QueueList } from '@/components/queue/QueueList'

const DEFAULT_ON: QueueBucket[] = ['urgent', 'new']  // backlog выключен по умолчанию

export function HomeworkQueuePage() {
  const [mode, setMode] = useState<QueueMode>('pending')
  const [active, setActive] = useState<Set<QueueBucket>>(new Set(DEFAULT_ON))
  const [groupBy, setGroupBy] = useState<'group' | 'flat'>('flat')
  const [courseId, setCourseId] = useState<string>('')
  const [groupId, setGroupId] = useState<string>('')
  const [studentId, setStudentId] = useState<string>('')
  const [sourceType, setSourceType] = useState<'' | 'legacy_homework' | 'task_collection'>('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const { items, counts, loading, loadingMore, reload, hasMore, loadMore, tabCounts } = useHomeworkQueue(mode, {
    courseId: courseId || null,
    groupId: groupId || null,
    studentId: studentId || null,
    sourceType: sourceType || null,
    overdueOnly,
  })

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

  const courseOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) {
      if (item.course.id && item.course.title) map.set(item.course.id, item.course.title)
    }
    return [...map.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  }, [items])

  const groupOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) {
      if (item.group.id && item.group.name) map.set(item.group.id, item.group.name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [items])

  const studentOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) map.set(item.student.id, item.student.name)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [items])

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="platform-surface rounded-lg p-5 sm:p-6 flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
            <Inbox size={13} />
            Homework Queue
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-graphite-950 flex items-center gap-2">
            Очередь задач
          </h1>
          <p className="mt-1 text-sm text-slate-500">Проверка, доработка и история сданных работ</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <div className="text-xs text-red-600">Срочно</div>
            <div className="font-semibold text-red-700">{counts.urgent}</div>
          </div>
          <div className="rounded-lg border border-gold-100 bg-gold-50 px-3 py-2">
            <div className="text-xs text-gold-700">На доработке</div>
            <div className="font-semibold text-gold-800">{tabCounts.returned}</div>
          </div>
          <div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2">
            <div className="text-xs text-primary-600">Новые</div>
            <div className="font-semibold text-primary-700">{counts.new}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
            <div className="text-xs text-slate-500">Всего</div>
            <div className="font-semibold text-graphite-950">{counts.total}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:shrink-0">
          {mode === 'pending' && (
            <button
              onClick={() => setGroupBy(g => g === 'flat' ? 'group' : 'flat')}
              className="min-h-11 flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg bg-white/80 hover:bg-white hover:border-primary-200 transition-colors"
              title="Переключить группировку"
            >
              {groupBy === 'flat' ? <Users size={15} /> : <List size={15} />}
              {groupBy === 'flat' ? 'По группам' : 'Списком'}
            </button>
          )}
          <button
            onClick={reload}
            className="w-11 h-11 flex items-center justify-center text-slate-400 border border-slate-200 rounded-lg bg-white/80 hover:bg-white hover:text-graphite-900 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <select
          value={courseId}
          onChange={e => { setCourseId(e.target.value); setGroupId('') }}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">Все курсы</option>
          {courseOptions.map(course => (
            <option key={course.id} value={course.id}>{course.title}</option>
          ))}
        </select>
        <select
          value={groupId}
          onChange={e => setGroupId(e.target.value)}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">Все группы</option>
          {groupOptions.map(group => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
        <select
          value={studentId}
          onChange={e => setStudentId(e.target.value)}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">Все ученики</option>
          {studentOptions.map(student => (
            <option key={student.id} value={student.id}>{student.name}</option>
          ))}
        </select>
        <select
          value={sourceType}
          onChange={e => setSourceType(e.target.value as '' | 'legacy_homework' | 'task_collection')}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">Все источники</option>
          <option value="legacy_homework">Legacy homework</option>
          <option value="task_collection">Task collection</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={e => setOverdueOnly(e.target.checked)}
          />
          Только просроченные
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('pending')}
          data-testid="queue-tab-pending"
          className={cn(
            'min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors',
            mode === 'pending' ? 'border-primary-950 bg-primary-950 text-white' : 'border-slate-200 bg-white/80 text-slate-500 hover:border-primary-200',
          )}
        >
          На проверке <span className="ml-1.5 text-xs opacity-70">{tabCounts.pending}</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('returned')}
          data-testid="queue-tab-returned"
          className={cn(
            'min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors',
            mode === 'returned' ? 'border-primary-950 bg-primary-950 text-white' : 'border-slate-200 bg-white/80 text-slate-500 hover:border-primary-200',
          )}
        >
          На доработке <span className="ml-1.5 text-xs opacity-70">{tabCounts.returned}</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('checked')}
          data-testid="queue-tab-checked"
          className={cn(
            'min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors',
            mode === 'checked' ? 'border-primary-950 bg-primary-950 text-white' : 'border-slate-200 bg-white/80 text-slate-500 hover:border-primary-200',
          )}
        >
          Проверенные <span className="ml-1.5 text-xs opacity-70">{tabCounts.checked}</span>
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
            emptyText={
              mode === 'pending'
                ? 'Очередь пуста, всё проверено'
                : mode === 'returned'
                  ? 'Работ на доработке пока нет'
                  : 'Проверенных работ пока нет'
            }
          />
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                className="min-h-11 rounded-lg border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-primary-200 hover:bg-white"
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
