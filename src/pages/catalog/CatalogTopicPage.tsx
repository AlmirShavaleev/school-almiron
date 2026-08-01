import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, CheckCircle2, BookOpen, AlertCircle, RefreshCw, Sparkles, ChevronDown } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

const PAGE_SIZE = 25
import { useCatalogTasks, useCatalogTopics, useCatalogSections, useCatalogPhysicsTopicSections, SUBJECT_SLUGS, type CatalogTask, type CatalogViewMode } from '@/hooks/useCatalog'
import { AddToCartButton } from '@/components/catalog/AddToCartButton'
import { CartBadge } from '@/components/catalog/CartBadge'
import { PhysicsTopicEditorButton } from '@/components/catalog/PhysicsTopicEditorButton'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import type { PhysicsDifficulty } from '@/lib/physicsDifficulty'

type Filter = 'all' | 'done' | 'todo'
type DifficultyFilter = PhysicsDifficulty

export function CatalogTopicPage() {
  const { sectionId, topicId } = useParams<{ sectionId: string; topicId: string }>()
  const profile = useAuthStore(state => state.profile)
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = (searchParams.get('filter') as Filter) ?? 'all'
  const view = (searchParams.get('view') as CatalogViewMode | null) ?? 'exam'
  const [retryKey, setRetryKey] = useState(0)
  const [difficultyFilter, setDifficultyFilter] = useState<Set<DifficultyFilter>>(new Set())
  const subjectSlugParam = searchParams.get('subject') ?? 'math'
  const examSlug = searchParams.get('exam') ?? 'ege'
  const subjectLabel = subjectSlugParam === 'physics' ? 'Физика' : 'Математика'
  const examLabel = examSlug === 'ege' ? 'ЕГЭ' : 'ОГЭ'
  const isPhysicsTopicsView = subjectSlugParam === 'physics' && examSlug === 'ege' && view === 'physics-topics'
  const canEditPhysicsTopics = isPhysicsTopicsView && !!profile?.role && ['admin', 'owner'].includes(profile.role)

  const { tasks, loading, error, toggleComplete } = useCatalogTasks(topicId, retryKey, view)
  const { sections: aiSections } = useCatalogPhysicsTopicSections(isPhysicsTopicsView, retryKey)
  const { sections } = useCatalogSections(subjectLabel, examLabel, retryKey)
  const examSection = sections.find(s => s.id === sectionId)
  const aiSection = aiSections.find(s => s.id === sectionId)
  const { topics } = useCatalogTopics(sectionId, retryKey, view, subjectLabel, examLabel)

  const topic   = topics.find(t => t.id === topicId)
  const sectionTitle = aiSection?.title ?? examSection?.title ?? 'Раздел'
  const subjectSlug = searchParams.get('subject')
    ?? (examSection ? (SUBJECT_SLUGS[examSection.subject] ?? 'math') : 'math')
  const viewSuffix = view === 'physics-topics' ? '&view=physics-topics' : ''

  const setFilter = (f: Filter) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (f === 'all') next.delete('filter'); else next.set('filter', f)
    return next
  })

  const filtered = useMemo(() => {
    const byCompletion =
      filter === 'done' ? tasks.filter(t => t.is_completed)
      : filter === 'todo' ? tasks.filter(t => !t.is_completed)
      : tasks

    if (difficultyFilter.size === 0) return byCompletion
    return byCompletion.filter(task => task.difficulty && difficultyFilter.has(task.difficulty))
  }, [tasks, filter, difficultyFilter])

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Reset pagination when topic or filter changes
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [topicId, filter])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [difficultyFilter])

  const visibleTasks = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const doneCount  = tasks.filter(t => t.is_completed).length
  const totalCount = tasks.length
  const pct = totalCount ? Math.round(doneCount / totalCount * 100) : 0

  // Скелет накрывает ТОЛЬКО список задач, а не всю страницу. Раньше при
  // переключении темы серым закрывалось всё: хлебные крошки, левый список тем
  // и фильтры — то есть ровно то, что не менялось. На четыре секунды это
  // выглядело как поломка, хотя менялся один блок.
  if (error) return <ErrorState message={error} onRetry={() => setRetryKey(key => key + 1)} />

  return (
    <div className="mx-auto max-w-7xl">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500 flex-wrap">
        <Link to={`/catalog?subject=${subjectSlug}&exam=${examSlug}${viewSuffix}`} className="hover:text-primary-600">Каталог</Link>
        <ChevronLeft className="w-3 h-3 rotate-180" />
        <Link to={`/catalog/${sectionId}?subject=${subjectSlug}&exam=${examSlug}${viewSuffix}`} className="hover:text-primary-600">{sectionTitle}</Link>
      </nav>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start xl:h-[calc(100vh-7.5rem)] xl:overflow-hidden">
          <div className="space-y-4 rounded-[28px] bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 backdrop-blur xl:flex xl:h-full xl:min-h-0 xl:flex-col">
            {topics.length > 1 && sectionId && (
              <div className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Темы раздела
                </div>
                <TopicSidebar
                  topics={topics}
                  activeTopicId={topicId}
                  sectionId={sectionId}
                  subjectSlug={subjectSlug}
                  examSlug={examSlug}
                  view={view}
                />
              </div>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-[28px] bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 backdrop-blur xl:flex-shrink-0">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 text-wrap-balance">{topic?.title ?? 'Тема'}</h1>
              <p className="mt-1 text-sm text-slate-500">Раздел: {sectionTitle}</p>
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

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Сложность
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: 'лёгкая', label: 'Лёгкая', active: 'bg-emerald-600 text-white shadow-[0_10px_20px_rgba(5,150,105,0.24)]', idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
                  { value: 'средняя', label: 'Средняя', active: 'bg-amber-500 text-white shadow-[0_10px_20px_rgba(245,158,11,0.24)]', idle: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
                  { value: 'сложная', label: 'Сложная', active: 'bg-rose-600 text-white shadow-[0_10px_20px_rgba(225,29,72,0.24)]', idle: 'bg-rose-50 text-rose-700 hover:bg-rose-100' },
                ] as const).map(option => {
                  const active = difficultyFilter.has(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setDifficultyFilter(prev => {
                          const next = new Set(prev)
                          if (next.has(option.value)) next.delete(option.value)
                          else next.add(option.value)
                          return next
                        })
                      }}
                      className={`min-h-10 rounded-2xl px-4 py-2 text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-200 active:scale-[0.96] ${active ? option.active : option.idle}`}
                    >
                      {option.label}
                    </button>
                  )
                })}
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
                view={view}
              />
            </div>
          )}

          <div>
            {loading ? (
              <TaskListSkeleton />
            ) : filtered.length === 0 ? (
              <EmptyState filter={filter} hasDifficultyFilter={difficultyFilter.size > 0} />
            ) : (
              <div className="space-y-4">
                {visibleTasks.map((task, idx) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    number={idx + 1}
                    onToggle={() => toggleComplete(task.id, !!task.is_completed)}
                    canEditPhysicsTopics={canEditPhysicsTopics}
                    topicId={topicId}
                    sectionId={sectionId}
                    retryKey={retryKey}
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
  view,
}: {
  topics: ReturnType<typeof useCatalogTopics>['topics']
  activeTopicId: string | undefined
  sectionId: string
  subjectSlug: string
  examSlug: string
  view: CatalogViewMode
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
              to={`/catalog/${sectionId}/topic/${topic.id}?subject=${subjectSlug}&exam=${examSlug}${view === 'physics-topics' ? '&view=physics-topics' : ''}`}
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
  view,
}: {
  topics: ReturnType<typeof useCatalogTopics>['topics']
  activeTopicId: string | undefined
  sectionId: string
  subjectSlug: string
  examSlug: string
  view: CatalogViewMode
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
              to={`/catalog/${sectionId}/topic/${root.id}?subject=${subjectSlug}&exam=${examSlug}${view === 'physics-topics' ? '&view=physics-topics' : ''}`}
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
                      to={`/catalog/${sectionId}/topic/${child.id}?subject=${subjectSlug}&exam=${examSlug}${view === 'physics-topics' ? '&view=physics-topics' : ''}`}
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
  canEditPhysicsTopics,
  topicId,
  sectionId,
  retryKey,
}: {
  task: CatalogTask
  number: number
  onToggle: () => void
  canEditPhysicsTopics: boolean
  topicId?: string
  sectionId?: string
  retryKey?: number
}) {
  return (
    <TaskDisplayCard
      task={task}
      number={number}
      onToggle={onToggle}
      completed={task.is_completed}
      extraActions={
        <>
          <AddToCartButton taskId={task.id} />
          {canEditPhysicsTopics && (
            <PhysicsTopicEditorButton
              task={task}
              topicId={topicId}
              sectionId={sectionId}
              retryKey={retryKey}
            />
          )}
        </>
      }
    />
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function EmptyState({ filter, hasDifficultyFilter }: { filter: Filter; hasDifficultyFilter: boolean }) {
  const msg =
    filter === 'done' ? 'Пока нет выполненных задач в этой теме.' :
    filter === 'todo' ? 'Все задачи выполнены!' :
    hasDifficultyFilter ? 'Задачи выбранной сложности не найдены.' :
    'Задачи не найдены.'
  return (
    <div className="py-16 text-center">
      <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500">{msg}</p>
    </div>
  )
}

/** Заглушка на месте карточек задач: остальная страница остаётся на экране. */
function TaskListSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-32 rounded-[28px] bg-slate-100" />
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="max-w-3xl mx-auto py-10 text-center">
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
