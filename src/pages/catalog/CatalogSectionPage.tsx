import { useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, BookOpen, Search, X, AlertCircle, RefreshCw } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCatalogTopics, useCatalogSections, useCatalogSearch, SUBJECT_SLUGS, useCatalogPhysicsTopicSections, type CatalogViewMode, type CatalogSection } from '@/hooks/useCatalog'
import { useAuthStore } from '@/store/authStore'

const STAFF_ROLES = new Set(['teacher', 'curator', 'admin', 'owner'])

export function CatalogSectionPage() {
  const { sectionId } = useParams<{ sectionId: string }>()
  const [searchParams] = useSearchParams()
  const subjectSlug = searchParams.get('subject') ?? 'math'
  const examSlug    = searchParams.get('exam')    ?? 'ege'
  const view = (searchParams.get('view') as CatalogViewMode | null) ?? 'exam'
  const subjectLabel = subjectSlug === 'physics' ? 'Физика' : 'Математика'
  const examLabel = examSlug === 'ege' ? 'ЕГЭ' : 'ОГЭ'
  const [retryKey, setRetryKey] = useState(0)
  const { sections: aiSections, loading: aiSectionsLoading, error: aiSectionsError } = useCatalogPhysicsTopicSections(subjectSlug === 'physics' && examSlug === 'ege' && view === 'physics-topics', retryKey)
  const { sections } = useCatalogSections(subjectLabel, examLabel, retryKey)
  const { topics, loading, error } = useCatalogTopics(sectionId, retryKey, view, subjectLabel, examLabel)
  const { profile } = useAuthStore()
  const aiSection = aiSections.find(s => s.id === sectionId)
  const examSection = sections.find(s => s.id === sectionId)
  const section = view === 'physics-topics' ? aiSection : examSection
  const backSlug = examSection ? (SUBJECT_SLUGS[examSection.subject] ?? subjectSlug) : subjectSlug

  const [query, setQuery] = useState('')
  const searchEnabled = view === 'exam'
  const { results: searchResults, loading: searchLoading, error: searchError } = useCatalogSearch(query, sectionId, searchEnabled)
  const isSearching = query.trim().length >= 2

  const isStaff = profile && STAFF_ROLES.has(profile.role)

  // Скелет только на месте списка тем. Хлебные крошки, заголовок раздела и
  // поиск не зависят от загрузки — сносить их вместе со списком значит
  // показывать пустой экран там, где половина содержимого уже известна.
  const listLoading = loading || (view === 'physics-topics' && aiSectionsLoading)
  if (error || (view === 'physics-topics' && aiSectionsError)) return <ErrorState message={(error || aiSectionsError)!} onRetry={() => setRetryKey(key => key + 1)} />

  // Build topic tree (root topics + their children)
  const roots = topics.filter(t => t.parent_id === null || !topics.find(p => p.id === t.parent_id))
  const childrenOf = (parentId: string) => topics.filter(t => t.parent_id === parentId)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link to={`/catalog?subject=${backSlug}&exam=${examSlug}${view === 'physics-topics' ? '&view=physics-topics' : ''}`} className="flex items-center gap-1 hover:text-primary-600">
          <ChevronLeft className="w-4 h-4" />
          Каталог
        </Link>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{section?.title ?? 'Раздел'}</h1>
        <p className="text-gray-500 text-sm mt-1">{view === 'physics-topics' ? 'Выберите физическую тему' : 'Выберите тему'}</p>
      </div>

      {subjectSlug === 'physics' && examSlug === 'ege' && (
        <div className="inline-flex rounded-2xl bg-slate-100 p-1 ring-1 ring-slate-200/80">
          <Link
            to={`/catalog?subject=${subjectSlug}&exam=${examSlug}`}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${view === 'exam' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Задания ЕГЭ
          </Link>
          <Link
            to={`/catalog?subject=${subjectSlug}&exam=${examSlug}&view=physics-topics`}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${view === 'physics-topics' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Физические темы
          </Link>
        </div>
      )}

      {/* Search */}
      {view === 'exam' && <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск по номеру или тексту задачи…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 bg-white"
          data-testid="catalog-search-input"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>}

      {/* Search results */}
      {view === 'exam' && isSearching ? (
        <div className="space-y-2">
          {searchLoading && (
            <div className="text-sm text-gray-400 text-center py-4">Поиск…</div>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-4">Ничего не найдено</div>
          )}
          {!searchLoading && searchError && (
            <ErrorState message={searchError} compact onRetry={() => setRetryKey(key => key + 1)} />
          )}
          {!searchLoading && !searchError && searchResults.map(r => (
            <Link
              key={r.id}
              to={`/catalog/task/${r.id}?subject=${backSlug}&exam=${examSlug}`}
              className="flex items-center justify-between gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-colors group"
              data-testid="search-result-item"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-gray-400">#{r.external_id}</span>
                  {isStaff && !r.hasTopicAssigned && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" data-testid="no-topic-badge">
                      Тема не назначена
                    </span>
                  )}
                </div>
                <div
                  className="text-sm text-gray-700 line-clamp-2 catalog-html"
                  dangerouslySetInnerHTML={{
                    __html: r.statement_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
                  }}
                />
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
            </Link>
          ))}
        </div>
      ) : listLoading ? (
        <TopicListSkeleton />
      ) : topics.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {roots.map(root => (
            <TopicGroup
              key={root.id}
              root={root}
              children={childrenOf(root.id)}
              sectionId={sectionId!}
              subjectSlug={backSlug}
              examSlug={examSlug}
              view={view}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicGroup({
  root,
  children,
  sectionId,
  subjectSlug,
  examSlug,
  view,
}: {
  root: ReturnType<typeof import('@/hooks/useCatalog').useCatalogTopics>['topics'][0]
  children: ReturnType<typeof import('@/hooks/useCatalog').useCatalogTopics>['topics']
  sectionId: string
  subjectSlug: string
  examSlug: string
  view: CatalogViewMode
}) {
  const hasChildren = children.length > 0
  const allTopics = hasChildren ? children : [root]

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Group header (only if there are children) */}
      {hasChildren && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <span className="font-semibold text-gray-700 text-sm">{root.title}</span>
        </div>
      )}

      {allTopics.map((topic, idx) => {
        const pct = topic.task_count ? Math.round((topic.completed_count ?? 0) / topic.task_count * 100) : 0
        return (
          <Link
            key={topic.id}
            to={`/catalog/${sectionId}/topic/${topic.id}?subject=${subjectSlug}&exam=${examSlug}${view === 'physics-topics' ? '&view=physics-topics' : ''}`}
            className={`group flex items-center justify-between gap-3 px-4 py-3 hover:bg-primary-50 transition-colors ${
              idx < allTopics.length - 1 ? 'border-b border-gray-100' : ''
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 group-hover:text-primary-700 transition-colors">
                {topic.title}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-500">{topic.task_count ?? 0} задач</span>
                {(topic.task_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1.5 flex-1">
                    <div className="h-1 flex-1 bg-gray-100 rounded-full overflow-hidden max-w-32">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">
                      <CheckCircle2 className="w-3 h-3 inline text-green-500" /> {topic.completed_count ?? 0}/{topic.task_count}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
          </Link>
        )
      })}
    </div>
  )
}

/** Заглушка на месте списка тем: шапка раздела остаётся на экране. */
function TopicListSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-slate-100" />
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry, compact = false }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={`max-w-3xl mx-auto px-4 text-center ${compact ? 'py-6' : 'py-16'}`}>
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

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500">Темы не найдены</p>
    </div>
  )
}
