import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Loader2, AlertTriangle, Search, X, Plus, Trash2, Wand2, CheckCircle2,
} from 'lucide-react'
import {
  useCourseTopicTests, useTopicSuggestions, useAiTopicSearch,
  KIND_LABELS, KIND_BLOCKED,
  type TopicOverviewRow, type CatalogTopicOption, type TopicLink, type BuildRow,
} from '@/hooks/useCourseTopicTests'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

/**
 * Сопоставление тем курса с темами каталога и массовая сборка тестов.
 *
 * Предложение по названиям — не подтверждение: владелец проходит список сам.
 * Поэтому рядом с каждым кандидатом стоит число задач: связь без задач
 * бесполезна, и это должно быть видно ДО сборки, а не после.
 */
export function CourseTopicTestsPage() {
  const { courseId } = useParams<{ courseId: string }>()
  const { rows, linksByTopic, loading, error, busy, addLink, removeLink, build } =
    useCourseTopicTests(courseId)

  const [count, setCount]   = useState(10)
  const [report, setReport] = useState<BuildRow[] | null>(null)
  const [onlyBuildable, setOnlyBuildable] = useState(true)

  const summary = useMemo(() => {
    const acc = { total: rows.length, buildable: 0, blocked: 0, linked: 0, ready: 0, withTest: 0 }
    for (const r of rows) {
      const blocked = !!KIND_BLOCKED[r.kind]
      if (blocked) acc.blocked += 1
      else {
        acc.buildable += 1
        if (r.linked_count > 0) acc.linked += 1
        if (r.available > 0) acc.ready += 1
      }
      if (r.has_test) acc.withTest += 1
    }
    return acc
  }, [rows])

  const blockedByReason = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const r of rows) {
      const reason = KIND_BLOCKED[r.kind]
      if (reason) acc[reason] = (acc[reason] ?? 0) + 1
    }
    return acc
  }, [rows])

  const visible = useMemo(
    () => onlyBuildable ? rows.filter(r => !KIND_BLOCKED[r.kind]) : rows,
    [rows, onlyBuildable],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={28} className="animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link to="/course-program" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
        <ArrowLeft size={14} /> К программе курса
      </Link>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Тесты по темам курса</h1>
      <p className="text-sm text-gray-500 mb-5">
        Тест собирается только из первой части: у второй автопроверяемых задач нет.
      </p>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Предполётная сводка: что и почему не соберётся — до сборки, не после. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="text-sm text-gray-800 mb-2">
          Тем в курсе: <span className="font-medium">{summary.total}</span> ·
          {' '}под тест: <span className="font-medium">{summary.buildable}</span> ·
          {' '}сопоставлено: <span className="font-medium">{summary.linked}</span> ·
          {' '}уже с тестом: <span className="font-medium">{summary.withTest}</span>
        </div>
        {Object.entries(blockedByReason).map(([reason, n]) => (
          <div key={reason} className="text-xs text-gray-500">
            {n} — {reason}
          </div>
        ))}

        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-100">
          <label className="text-sm text-gray-600">Задач в тесте</label>
          <input
            type="number" min={1} max={50} value={count}
            onChange={e => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <Button
            variant="primary" size="sm" disabled={busy || summary.linked === 0}
            onClick={() => { void build(count, false).then(r => r && setReport(r)) }}
          >
            {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
            Собрать тесты по курсу
          </Button>
          <label className="flex items-center gap-1.5 text-sm text-gray-500 ml-auto">
            <input type="checkbox" checked={onlyBuildable} onChange={e => setOnlyBuildable(e.target.checked)} />
            только те, где тест возможен
          </label>
        </div>
        {summary.linked === 0 && (
          <p className="text-xs text-gray-400 mt-2">
            Сначала сопоставьте хотя бы одну тему — собирать пока нечего.
          </p>
        )}
      </div>

      {report && <BuildReport report={report} onClose={() => setReport(null)} />}

      <div className="space-y-2">
        {visible.map(row => (
          <TopicRow
            key={row.topic_id}
            row={row}
            links={linksByTopic.get(row.topic_id) ?? []}
            busy={busy}
            onAdd={id => void addLink(row.topic_id, id)}
            onRemove={linkId => void removeLink(linkId)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Отчёт сборки ─────────────────────────────────────────────────────────────

function BuildReport({ report, onClose }: { report: BuildRow[]; onClose: () => void }) {
  const built   = report.filter(r => r.status === 'built')
  const partial = built.filter(r => r.note)
  const failed  = report.filter(r => r.status === 'no_tasks')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900">Отчёт сборки</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
      </div>
      <div className="text-sm text-gray-700 flex items-center gap-1.5">
        <CheckCircle2 size={14} className="text-emerald-600" />
        Собрано тестов: {built.length}
      </div>
      {/* Неполные и повторы показываем поимённо: молчаливое «добили чем попало»
          читается учеником как поломка системы. */}
      {partial.length > 0 && (
        <div className="mt-2 space-y-1">
          {partial.map(r => (
            <div key={r.topic_id} className="text-xs text-amber-700">
              {r.topic_title} — {r.note}
            </div>
          ))}
        </div>
      )}
      {failed.length > 0 && (
        <div className="mt-2 space-y-1">
          {failed.map(r => (
            <div key={r.topic_id} className="text-xs text-red-600">
              {r.topic_title} — {r.note}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Строка темы ──────────────────────────────────────────────────────────────

function TopicRow({ row, links, busy, onAdd, onRemove }: {
  row: TopicOverviewRow
  links: TopicLink[]
  busy: boolean
  onAdd: (catalogTopicId: string) => void
  onRemove: (linkId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const blocked = KIND_BLOCKED[row.kind]

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800">{row.topic_title}</span>
            <Badge variant={blocked ? 'default' : 'info'}>{KIND_LABELS[row.kind]}</Badge>
            {row.has_test && <Badge variant="success">тест собран</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {row.module_title}
            {blocked
              ? ` · ${blocked}`
              : row.linked_count === 0
                ? ' · тема каталога не выбрана'
                : ` · задач по связке: ${row.available}`}
          </div>

          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {links.map(l => (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  {l.title}
                  <button
                    type="button" disabled={busy} onClick={() => onRemove(l.id)}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                    title="Убрать связь"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={() => setOpen(v => !v)} disabled={busy}>
          {open ? 'Свернуть' : 'Сопоставить'}
        </Button>
      </div>

      {open && <TopicPicker topicId={row.topic_id} busy={busy} onAdd={onAdd} />}
    </div>
  )
}

function TopicPicker({ topicId, busy, onAdd }: {
  topicId: string
  busy: boolean
  onAdd: (catalogTopicId: string) => void
}) {
  const [search, setSearch] = useState('')
  const searching = search.trim().length > 0
  const { items: suggestions, loading: sugLoading } = useTopicSuggestions(topicId)
  const { items: found, loading: findLoading } = useAiTopicSearch(search, searching)

  const list: CatalogTopicOption[] = searching ? found : suggestions
  const loading = searching ? findLoading : sugLoading

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по темам каталога…"
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Загрузка…
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-500 py-1">
          {searching
            ? 'Ничего не найдено.'
            : 'Уверенных совпадений по названию нет — выберите тему поиском.'}
        </p>
      ) : (
        <div className="space-y-1">
          {!searching && (
            <p className="text-xs text-gray-400 mb-1">Предложения по названию — проверьте перед подтверждением</p>
          )}
          {list.map(opt => (
            <button
              key={opt.catalog_topic_id}
              type="button"
              disabled={busy}
              onClick={() => onAdd(opt.catalog_topic_id)}
              className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <Plus size={13} className="text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{opt.title}</span>
              <span className={`text-xs shrink-0 ${opt.available > 0 ? 'text-gray-400' : 'text-amber-600'}`}>
                {opt.available > 0 ? `${opt.available} задач` : 'нет задач'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
