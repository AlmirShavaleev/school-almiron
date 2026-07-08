import { useState, useMemo, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, CheckCircle2, BookOpen } from 'lucide-react'

const PAGE_SIZE = 25
import { useCatalogTasks, useCatalogTopics, useCatalogSections, SUBJECT_SLUGS, type CatalogTask } from '@/hooks/useCatalog'
import { AddToCartButton } from '@/components/catalog/AddToCartButton'
import { CartBadge } from '@/components/catalog/CartBadge'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'

type Filter = 'all' | 'done' | 'todo'

export function CatalogTopicPage() {
  const { sectionId, topicId } = useParams<{ sectionId: string; topicId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = (searchParams.get('filter') as Filter) ?? 'all'

  const { tasks, loading, error, toggleComplete } = useCatalogTasks(topicId)
  const { topics } = useCatalogTopics(sectionId)
  const { sections } = useCatalogSections()

  const topic   = topics.find(t => t.id === topicId)
  const section = sections.find(s => s.id === sectionId)
  const subjectSlug = searchParams.get('subject')
    ?? (section ? (SUBJECT_SLUGS[section.subject] ?? 'math') : 'math')
  const examSlug = searchParams.get('exam') ?? 'ege'

  const setFilter = (f: Filter) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (f === 'all') next.delete('filter'); else next.set('filter', f)
    return next
  })

  const filtered = useMemo(() => {
    if (filter === 'done') return tasks.filter(t => t.is_completed)
    if (filter === 'todo') return tasks.filter(t => !t.is_completed)
    return tasks
  }, [tasks, filter])

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Reset pagination when topic or filter changes
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [topicId, filter])

  const visibleTasks = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const doneCount  = tasks.filter(t => t.is_completed).length
  const totalCount = tasks.length
  const pct = totalCount ? Math.round(doneCount / totalCount * 100) : 0

  if (loading) return <TopicSkeleton />
  if (error)   return <ErrorState message={error} />

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
        <Link to={`/catalog?subject=${subjectSlug}&exam=${examSlug}`} className="hover:text-primary-600">Каталог</Link>
        <ChevronLeft className="w-3 h-3 rotate-180" />
        <Link to={`/catalog/${sectionId}?subject=${subjectSlug}&exam=${examSlug}`} className="hover:text-primary-600">{section?.title ?? 'Раздел'}</Link>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{topic?.title ?? 'Тема'}</h1>

        {/* Progress */}
        {totalCount > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm text-gray-500 mb-1.5">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Выполнено {doneCount} из {totalCount}
              </span>
              <span className="font-medium text-gray-700">{pct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'todo', 'done'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'Все' : f === 'done' ? 'Выполнено' : 'Не выполнено'}
          </button>
        ))}
      </div>

      {/* Tasks */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-4">
          {visibleTasks.map((task, idx) => (
            <TaskCard
              key={task.id}
              task={task}
              number={idx + 1}
              onToggle={() => toggleComplete(task.id, !!task.is_completed)}
            />
          ))}
          {hasMore && (
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-primary-400 hover:text-primary-700 transition-all font-medium"
            >
              Показать ещё {Math.min(PAGE_SIZE, filtered.length - visibleCount)} задач
              <span className="text-gray-400 ml-1">({visibleCount} из {filtered.length})</span>
            </button>
          )}
        </div>
      )}

      <CartBadge />
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  number,
  onToggle,
}: {
  task: CatalogTask
  number: number
  onToggle: () => void
}) {
  return (
    <TaskDisplayCard
      task={task}
      number={number}
      onToggle={onToggle}
      completed={task.is_completed}
      extraActions={<AddToCartButton taskId={task.id} />}
    />
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: Filter }) {
  const msg =
    filter === 'done' ? 'Пока нет выполненных задач в этой теме.' :
    filter === 'todo' ? 'Все задачи выполнены!' :
    'Задачи не найдены.'
  return (
    <div className="py-16 text-center">
      <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500">{msg}</p>
    </div>
  )
}

function TopicSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-32" />
      <div className="h-7 bg-gray-200 rounded w-64" />
      <div className="h-8 bg-gray-100 rounded-full w-48" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-gray-100 rounded-xl h-32" />
      ))}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <p className="text-red-600 font-medium">Ошибка загрузки</p>
      <p className="text-gray-500 text-sm mt-1">{message}</p>
    </div>
  )
}
