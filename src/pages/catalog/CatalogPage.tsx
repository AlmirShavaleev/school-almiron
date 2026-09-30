import { useState, useMemo } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Search, X, AlertCircle, RefreshCw } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  useCatalogSections,
  useCatalogPhysicsTopicSections,
  DIRECTIONS,
  SUBJECT_FROM_SLUG,
  SUBJECT_SLUGS,
  EXAM_FROM_SLUG,
  EXAM_SLUGS,
  type CatalogViewMode,
  type CatalogTopic,
} from '@/hooks/useCatalog'
import { useAuthStore } from '@/store/authStore'
import { CatalogHome } from '@/components/catalog/CatalogHome'
import type { CatalogSection } from '@/hooks/useCatalog'

function numFmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} тыс.`
  return String(n)
}

// ══════════════════════════════════════════════════════════════════════════════
// Main export — главная каталога (§246) или список разделов экзамена
// ══════════════════════════════════════════════════════════════════════════════

export function CatalogPage() {
  const [searchParams] = useSearchParams()
  const subjectParam   = searchParams.get('subject')
  const examParam      = searchParams.get('exam')
  const viewParam      = (searchParams.get('view') as CatalogViewMode | null) ?? 'exam'

  if (!subjectParam) return <CatalogHome />
  return <SectionsView subjectSlug={subjectParam} examSlug={examParam ?? 'ege'} view={viewParam} />
}

// ══════════════════════════════════════════════════════════════════════════════
// Sections view — compact numbered list
// ══════════════════════════════════════════════════════════════════════════════

function SectionsView({ subjectSlug, examSlug, view }: { subjectSlug: string; examSlug: string; view: CatalogViewMode }) {
  const { profile } = useAuthStore()
  const isStudent   = profile?.role === 'student'

  const subject  = SUBJECT_FROM_SLUG[subjectSlug] ?? 'Математика'
  const examType = EXAM_FROM_SLUG[examSlug]        ?? 'ЕГЭ'
  const isPhysicsTopicsAvailable = subject === 'Физика' && examType === 'ЕГЭ'
  const activeView: CatalogViewMode = isPhysicsTopicsAvailable ? view : 'exam'
  const direction = DIRECTIONS.find(d => d.subjectSlug === subjectSlug && d.examSlug === examSlug)
  const dirLabel  = direction?.label ?? `${subject} ${examType}`

  const [retryKey, setRetryKey] = useState(0)
  const { sections, loading, error } = useCatalogSections(subject, examType, retryKey)
  const {
    sections: aiSections,
    totalTaskCount: aiTotalTaskCount,
    totalCompletedCount: aiTotalCompletedCount,
    loading: aiLoading,
    error: aiError,
  } = useCatalogPhysicsTopicSections(isPhysicsTopicsAvailable && activeView === 'physics-topics', retryKey)
  const navigate = useNavigate()

  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const examSections = sections
  const physicsSections = aiSections
  const sectionItems = activeView === 'physics-topics' ? physicsSections : examSections
  const sectionLoading = activeView === 'physics-topics' ? aiLoading : loading
  const sectionError = activeView === 'physics-topics' ? aiError : error

  const sortedExamSections = useMemo(() =>
    [...examSections].sort((a, b) => {
      const an = a.exam_number ?? 999
      const bn = b.exam_number ?? 999
      if (an === 0) return 1
      if (bn === 0) return -1
      return an - bn || a.position - b.position
    }),
  [examSections])

  const sortedPhysicsSections = useMemo(() => [...physicsSections].sort((a, b) => a.position - b.position), [physicsSections])
  const sorted = activeView === 'physics-topics' ? sortedPhysicsSections : sortedExamSections

  // Client-side filter by title / exam_number string
  const filtered = useMemo(() => {
    if (!q) return sorted
    return sorted.filter((s: CatalogSection | CatalogTopic) => {
      if (activeView === 'physics-topics') {
        return s.title.toLowerCase().includes(q)
      }
      const examSection = s as CatalogSection
      const num   = String(examSection.exam_number ?? '')
      const title = (examSection.exam_number === 0 ? 'Задачи старого формата ЕГЭ' : examSection.title).toLowerCase()
      return title.includes(q) || num.includes(q)
    })
  }, [sorted, q, activeView])

  const totalTasks = activeView === 'physics-topics'
    ? aiTotalTaskCount
    : sectionItems.reduce((sum, s) => sum + (s.task_count ?? 0), 0)
  const totalCompletedTasks = activeView === 'physics-topics'
    ? aiTotalCompletedCount
    : sectionItems.reduce((sum, s) => sum + (s.completed_count ?? 0), 0)

  const sectionLink = (s: CatalogSection) =>
    `/catalog/${s.id}?subject=${SUBJECT_SLUGS[s.subject] ?? subjectSlug}&exam=${examSlug}`
  const aiSectionLink = (s: CatalogSection) =>
    `/catalog/${s.id}?subject=${subjectSlug}&exam=${examSlug}&view=physics-topics`

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500" aria-label="breadcrumb">
        <Link to="/catalog" className="hover:text-primary-600 transition-colors">
          Каталог
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
        <span className="text-gray-700 font-medium">{dirLabel}</span>
      </nav>

      {/* Direction header + back button */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{dirLabel}</h1>
          {!sectionLoading && sectionItems.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              {sectionItems.length}&nbsp;{sectionItems.length === 1 ? 'раздел' : 'разделов'}
              &nbsp;·&nbsp;{numFmt(totalTasks)}&nbsp;задач
              {isStudent && totalTasks > 0 ? (
                <>
                  {' · '}
                  <span className="tabular-nums">{totalCompletedTasks}&nbsp;из&nbsp;{totalTasks}</span>
                </>
              ) : null}
            </p>
          )}
        </div>
        <Link
          to="/catalog"
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-primary-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-primary-300 bg-white transition-colors"
          data-testid="back-to-directions"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Выбрать другое направление
        </Link>
      </div>

      {isPhysicsTopicsAvailable && (
        <div className="inline-flex rounded-2xl bg-slate-100 p-1 ring-1 ring-slate-200/80">
          <button
            type="button"
            onClick={() => navigate(`/catalog?subject=${subjectSlug}&exam=${examSlug}`)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'exam' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Задания ЕГЭ
          </button>
          <button
            type="button"
            onClick={() => navigate(`/catalog?subject=${subjectSlug}&exam=${examSlug}&view=physics-topics`)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'physics-topics' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Физические темы
          </button>
        </div>
      )}

      {/* Filter input */}
      {activeView === 'exam' && (
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Поиск по номеру или названию раздела…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
          data-testid="section-filter-input"
        />
        {filter && (
          <button
            onClick={() => setFilter('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Очистить"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      )}

      {/* Content */}
      {sectionLoading ? (
        <SectionsSkeleton />
      ) : sectionError ? (
        <ErrorState message={sectionError} onRetry={() => setRetryKey(k => k + 1)} />
      ) : filtered.length === 0 && q ? (
        <EmptyState message={`По запросу «${filter}» разделов не найдено`} />
      ) : sorted.length === 0 ? (
        <EmptyState message="Разделы не найдены. Попросите администратора загрузить каталог." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="sections-grid">
          {filtered.map(s => (
            <SectionCard
              key={s.id}
              section={s as CatalogSection}
              to={activeView === 'physics-topics' ? aiSectionLink(s as CatalogSection) : sectionLink(s as CatalogSection)}
              isStudent={isStudent}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Compact section card ───────────────────────────────────────────────────────

function SectionCard({
  section: s,
  to,
  isStudent,
}: {
  section: CatalogSection
  to: string
  isStudent: boolean
}) {
  const pct          = s.task_count ? Math.round((s.completed_count ?? 0) / s.task_count * 100) : 0
  const displayTitle = s.exam_number === 0 ? 'Задачи старого формата ЕГЭ' : s.title
  const numBadge     = s.exam_number && s.exam_number > 0 ? `№${s.exam_number}` : null

  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-primary-400 hover:bg-primary-50/40 transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      data-testid="section-card"
    >
      {/* Number badge */}
      {numBadge ? (
        <span className="flex-shrink-0 w-10 text-center text-xs font-mono font-semibold text-primary-600 bg-primary-50 ring-1 ring-primary-100 rounded-lg py-1.5 leading-none">
          {numBadge}
        </span>
      ) : (
        <span className="flex-shrink-0 w-10 text-center text-xs font-mono text-gray-400 bg-gray-50 ring-1 ring-gray-100 rounded-lg py-1.5 leading-none">
          —
        </span>
      )}

      {/* Title + stats */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 group-hover:text-primary-700 transition-colors leading-snug line-clamp-2">
          {displayTitle}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {s.task_count ?? 0}&nbsp;задач
          {isStudent && s.task_count ? (
            <>
              {' · '}
              <span className={pct > 0 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                {s.completed_count ?? 0}&nbsp;из&nbsp;{s.task_count}&nbsp;—&nbsp;{pct}%
              </span>
            </>
          ) : null}
        </div>

        {/* Thin progress bar — students only */}
        {isStudent && (s.task_count ?? 0) > 0 && (
          <div className="mt-1.5 h-0.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-primary-500 group-hover:translate-x-0.5 flex-shrink-0 transition-all" />
    </Link>
  )
}

// ── Skeleton / error / empty ───────────────────────────────────────────────────

function SectionsSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-[72px] bg-gray-100 rounded-xl" />
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="py-16 text-center">
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-16 text-center">
      <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-3" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}

// unused-export guard
void EXAM_SLUGS
