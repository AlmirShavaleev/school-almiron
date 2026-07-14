import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, CheckCircle2, BookOpen, AlertCircle, RefreshCw, Sparkles, ChevronDown } from 'lucide-react'

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
  const [retryKey, setRetryKey] = useState(0)

  const { tasks, loading, error, toggleComplete } = useCatalogTasks(topicId, retryKey)
  const { topics } = useCatalogTopics(sectionId, retryKey)
  const { sections } = useCatalogSections(undefined, undefined, retryKey)

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
  if (error)   return <ErrorState message={error} onRetry={() => setRetryKey(key => key + 1)} />

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500 flex-wrap">
        <Link to={`/catalog?subject=${subjectSlug}&exam=${examSlug}`} className="hover:text-primary-600">Каталог</Link>
        <ChevronLeft className="w-3 h-3 rotate-180" />
        <Link to={`/catalog/${sectionId}?subject=${subjectSlug}&exam=${examSlug}`} className="hover:text-primary-600">{section?.title ?? 'Раздел'}</Link>
      </nav>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start xl:h-[calc(100vh-7.5rem)] xl:overflow-hidden">
          <div className="space-y-4 rounded-[28px] bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 backdrop-blur xl:flex xl:h-full xl:min-h-0 xl:flex-col">
            {topics.length > 1 && sectionId && (
              <div className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Темы раздела
                </div>
                <div className="mb-2 hidden px-1 text-xs text-slate-400 xl:block">
                  Наведи курсор сюда, чтобы крутить каталог
                </div>
                <TopicSidebar
                  topics={topics}
                  activeTopicId={topicId}
                  sectionId={sectionId}
                  subjectSlug={subjectSlug}
                  examSlug={examSlug}
                />
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-[28px] bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 backdrop-blur xl:flex-shrink-0">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 text-wrap-balance">{topic?.title ?? 'Тема'}</h1>
              <p className="mt-1 text-sm text-slate-500">Раздел: {section?.title ?? 'Каталог'}</p>
            </div>

            {totalCount > 0 && (
              <div className="mt-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/80">
                <div className="mb-1.5 flex items-center justify-between text-sm text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Выполнено {doneCount} из {totalCount}
                  </span>
                  <span className="font-medium text-gray-700 tabular-nums">{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-green-500 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Показывать
              </div>
              <div className="flex flex-wrap gap-2">
                {(['all', 'todo', 'done'] as Filter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`min-h-10 rounded-2xl px-4 py-2 text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-200 active:scale-[0.96] ${
                      filter === f
                        ? 'bg-primary-600 text-white shadow-[0_10px_20px_rgba(37,99,235,0.24)]'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {f === 'all' ? 'Все' : f === 'done' ? 'Выполнено' : 'Не выполнено'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {topics.length > 1 && sectionId && (
            <div className="xl:hidden">
              <TopicSwitcher
                topics={topics}
                activeTopicId={topicId}
                sectionId={sectionId}
                subjectSlug={subjectSlug}
                examSlug={examSlug}
              />
            </div>
          )}

          <div>
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
                    className="w-full rounded-2xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-[background-color,color,border-color,transform] hover:bg-gray-50 hover:border-primary-400 hover:text-primary-700 active:scale-[0.99]"
                  >
                    Показать ещё {Math.min(PAGE_SIZE, filtered.length - visibleCount)} задач
                    <span className="ml-1 text-gray-400 tabular-nums">({visibleCount} из {filtered.length})</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <CartBadge />
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TopicSwitcher({
  topics,
  activeTopicId,
  sectionId,
  subjectSlug,
  examSlug,
}: {
  topics: ReturnType<typeof useCatalogTopics>['topics']
  activeTopicId: string | undefined
  sectionId: string
  subjectSlug: string
  examSlug: string
}) {
  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-r from-slate-50 via-white to-blue-50/70 p-3 ring-1 ring-slate-200/80 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-slate-500">
        <Sparkles className="h-3.5 w-3.5 text-blue-500" />
        Быстрый переход по темам раздела
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {topics.map(topic => {
          const pct = topic.task_count ? Math.round(((topic.completed_count ?? 0) / topic.task_count) * 100) : 0
          const active = topic.id === activeTopicId
          return (
            <Link
              key={topic.id}
              to={`/catalog/${sectionId}/topic/${topic.id}?subject=${subjectSlug}&exam=${examSlug}`}
              className={`group min-w-[220px] shrink-0 rounded-2xl px-4 py-3 text-left transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.96] ${
                active
                  ? 'bg-blue-600 text-white shadow-[0_12px_24px_rgba(37,99,235,0.28)]'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:ring-blue-200 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
              }`}
            >
              <div className="line-clamp-2 text-sm font-semibold leading-5 text-wrap-pretty">
                {topic.title}
              </div>
              <div className={`mt-2 flex items-center justify-between text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                <span className="tabular-nums">{topic.task_count ?? 0} задач</span>
                <span className="tabular-nums">{topic.completed_count ?? 0}/{topic.task_count ?? 0}</span>
              </div>
              <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${active ? 'bg-white/20' : 'bg-slate-100'}`}>
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${active ? 'bg-white' : 'bg-emerald-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function TopicSidebar({
  topics,
  activeTopicId,
  sectionId,
  subjectSlug,
  examSlug,
}: {
  topics: ReturnType<typeof useCatalogTopics>['topics']
  activeTopicId: string | undefined
  sectionId: string
  subjectSlug: string
  examSlug: string
}) {
  const activeTopicRef = useRef<HTMLAnchorElement | null>(null)
  const rootTopics = useMemo(
    () => topics.filter(topic => topic.parent_id === null || !topics.some(parent => parent.id === topic.parent_id)),
    [topics]
  )
  const childMap = useMemo(() => {
    const map = new Map<string, typeof topics>()
    for (const topic of topics) {
      if (!topic.parent_id) continue
      const list = map.get(topic.parent_id) ?? []
      list.push(topic)
      map.set(topic.parent_id, list)
    }
    return map
  }, [topics])
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setOpenGroups(prev => {
      const next: Record<string, boolean> = {}
      for (const root of rootTopics) {
        const children = childMap.get(root.id) ?? []
        const hasActiveChild = children.some(child => child.id === activeTopicId)
        const isActiveRoot = root.id === activeTopicId
        next[root.id] = prev[root.id] ?? (isActiveRoot || hasActiveChild)
      }
      return next
    })
  }, [activeTopicId, childMap, rootTopics])

  useEffect(() => {
    activeTopicRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeTopicId])

  return (
    <div className="xl:min-h-0 xl:flex-1 xl:overflow-hidden">
      <div className="space-y-2 xl:h-full xl:overflow-y-auto xl:pr-1">
      {rootTopics.map(root => {
        const children = childMap.get(root.id) ?? []
        const isAccordion = children.length > 0
        const isOpen = openGroups[root.id] ?? false
        const isActiveRoot = root.id === activeTopicId

        if (!isAccordion) {
          return (
            <TopicSidebarLink
              key={root.id}
              topic={root}
              active={isActiveRoot}
              to={`/catalog/${sectionId}/topic/${root.id}?subject=${subjectSlug}&exam=${examSlug}`}
              linkRef={isActiveRoot ? activeTopicRef : null}
            />
          )
        }

        const aggregateDone = children.reduce((sum, topic) => sum + (topic.completed_count ?? 0), 0)
        const aggregateTotal = children.reduce((sum, topic) => sum + (topic.task_count ?? 0), 0)
        const aggregatePct = aggregateTotal ? Math.round((aggregateDone / aggregateTotal) * 100) : 0
        const hasActiveChild = children.some(child => child.id === activeTopicId)

        return (
          <div key={root.id} className="rounded-3xl bg-slate-50/90 p-2 ring-1 ring-slate-200/80">
            <button
              type="button"
              onClick={() => setOpenGroups(prev => ({ ...prev, [root.id]: !isOpen }))}
              className={`flex w-full items-start justify-between gap-3 rounded-[20px] px-3 py-3 text-left transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] ${
                hasActiveChild || isOpen
                  ? 'bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.06)]'
                  : 'text-slate-700 hover:bg-white/80'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-semibold leading-5 text-wrap-pretty">
                  {root.title}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span className="tabular-nums">{aggregateTotal} задач</span>
                  <span className="tabular-nums">{aggregateDone}/{aggregateTotal}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${aggregatePct}%` }}
                  />
                </div>
              </div>
              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="mt-2 space-y-2 px-1 pb-1">
                {children.map(child => {
                  const active = child.id === activeTopicId
                  return (
                    <TopicSidebarLink
                      key={child.id}
                      topic={child}
                      active={active}
                      compact
                      to={`/catalog/${sectionId}/topic/${child.id}?subject=${subjectSlug}&exam=${examSlug}`}
                      linkRef={active ? activeTopicRef : null}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

function TopicSidebarLink({
  topic,
  active,
  to,
  compact = false,
  linkRef,
}: {
  topic: ReturnType<typeof useCatalogTopics>['topics'][number]
  active: boolean
  to: string
  compact?: boolean
  linkRef?: React.RefObject<HTMLAnchorElement | null> | null
}) {
  const pct = topic.task_count ? Math.round(((topic.completed_count ?? 0) / topic.task_count) * 100) : 0

  return (
    <Link
      ref={linkRef ?? null}
      to={to}
      className={`block rounded-2xl transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] ${
        compact ? 'p-3' : 'p-3.5'
      } ${
        active
          ? 'bg-blue-600 text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)]'
          : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200/80 hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]'
      }`}
    >
      <div className={`line-clamp-2 font-semibold leading-5 text-wrap-pretty ${compact ? 'text-[13px]' : 'text-sm'}`}>
        {topic.title}
      </div>
      <div className={`mt-2 flex items-center justify-between text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>
        <span className="tabular-nums">{topic.task_count ?? 0} задач</span>
        <span className="tabular-nums">{topic.completed_count ?? 0}/{topic.task_count ?? 0}</span>
      </div>
      <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${active ? 'bg-white/20' : 'bg-white'}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${active ? 'bg-white' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </Link>
  )
}

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

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <AlertCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
      <p className="text-red-600 font-medium">Не удалось загрузить каталог</p>
      <p className="text-gray-500 text-sm mt-1 mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-primary-400 hover:text-primary-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Повторить
        </button>
      )}
    </div>
  )
}
