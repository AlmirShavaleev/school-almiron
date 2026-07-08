import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, ChevronUp, ChevronDown, Save, X, FileText, CheckSquare, BookOpen, FileDown } from 'lucide-react'
import { useCollection, useSaveCollection, useDeleteCollectionItem } from '@/hooks/useCollections'
import { useCatalogTasksBatch } from '@/hooks/useCatalog'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'
import type { TaskCollectionItem } from '@/types/collections'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'

type ViewMode = 'statements' | 'answers' | 'solutions'

export function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, error, reload } = useCollection(id)
  const { save, loading: saving } = useSaveCollection()

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState('')
  const [titleError,   setTitleError]   = useState<string | null>(null)
  const [viewMode,     setViewMode]     = useState<ViewMode>('statements')
  const [showPdfPanel, setShowPdfPanel] = useState(false)

  // Optimistic local item ordering
  const [localItems, setLocalItems] = useState<TaskCollectionItem[] | null>(null)
  const items = localItems ?? data?.items ?? []
  const dirty = localItems !== null

  // Batch-load all tasks in the collection (single round-trip)
  const taskIds = useMemo(() => items.map(i => i.catalog_task_id), [items])
  const { tasks: batchTasks, loading: tasksLoading } = useCatalogTasksBatch(taskIds)

  // Map taskId → task for O(1) lookup
  const taskMap = useMemo(
    () => new Map(batchTasks.map(t => [t.id, t])),
    [batchTasks]
  )

  // Items shaped for the unified print/preview renderer (VariantDocument)
  const printItems: PrintableItem[] = useMemo(
    () => items.map(it => ({
      id:           it.id,
      customNumber: it.custom_number,
      task:         taskMap.get(it.catalog_task_id),
    })),
    [items, taskMap]
  )

  // Collections don't track exam type directly — infer from the tasks themselves
  const examType = useMemo(
    () => batchTasks.find(t => t.exam_type)?.exam_type ?? '',
    [batchTasks]
  )

  if (loading) return <PageSkeleton />
  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-red-600">{error ?? 'Подборка не найдена'}</p>
        <Link to="/collections" className="text-blue-600 hover:underline text-sm">
          Назад к подборкам
        </Link>
      </div>
    )
  }

  const { collection } = data

  // ── Title edit ──────────────────────────────────────────────────────────────

  const startEditTitle = () => {
    setTitleDraft(collection.title)
    setTitleError(null)
    setEditingTitle(true)
  }

  const cancelEditTitle = () => { setEditingTitle(false); setTitleError(null) }

  const saveTitle = async () => {
    const trimmed = titleDraft.trim()
    if (!trimmed) { setTitleError('Название не может быть пустым'); return }
    const ok = await save({
      collection_id: collection.id,
      title:         trimmed,
      description:   collection.description,
      subject:       collection.subject,
      work_type:     collection.work_type,
      items:         items.map((it, idx) => ({
        catalog_task_id: it.catalog_task_id,
        position:        idx + 1,
        custom_number:   it.custom_number,
      })),
    })
    if (ok) { setEditingTitle(false); reload() }
  }

  // ── Item reorder ────────────────────────────────────────────────────────────

  const moveItem = (idx: number, direction: -1 | 1) => {
    const target = idx + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setLocalItems(next)
  }

  const saveOrder = async () => {
    const ok = await save({
      collection_id: collection.id,
      title:         collection.title,
      description:   collection.description,
      subject:       collection.subject,
      work_type:     collection.work_type,
      items:         items.map((it, idx) => ({
        catalog_task_id: it.catalog_task_id,
        position:        idx + 1,
        custom_number:   it.custom_number,
      })),
    })
    if (ok) { setLocalItems(null); reload() }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/collections"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={14} /> Мои подборки
      </Link>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">

          {editingTitle ? (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') cancelEditTitle() }}
                className="w-full px-3 py-2 border border-blue-400 rounded-lg text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {titleError && <p className="text-xs text-red-600">{titleError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={saveTitle}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={13} /> {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button
                  onClick={cancelEditTitle}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200"
                >
                  <X size={13} /> Отмена
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{collection.title}</h1>
              <button
                onClick={startEditTitle}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                title="Переименовать"
              >
                <Pencil size={15} />
              </button>
            </div>
          )}
          <p className="text-sm text-gray-500 mt-1">
            {collection.subject} · {collection.work_type} · {items.length} задание(й)
          </p>
        </div>

        {/* PDF export */}
        {items.length > 0 && !tasksLoading && (
          <button
            onClick={() => setShowPdfPanel(v => !v)}
            title="Экспорт в PDF"
            aria-expanded={showPdfPanel}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              showPdfPanel
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
            }`}
          >
            <FileDown size={15} /> PDF
          </button>
        )}
      </div>

      {/* Inline PDF export panel (unified VariantDocument renderer — no modal, no route) */}
      {showPdfPanel && items.length > 0 && !tasksLoading && (
        <VariantPrintPanel
          items={printItems}
          subject={collection.subject}
          examType={examType}
          initialTitle={collection.title}
        />
      )}

      {/* Dirty banner */}
      {dirty && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="text-sm text-amber-800">Порядок изменён — не сохранено</span>
          <div className="flex gap-2">
            <button onClick={() => setLocalItems(null)} className="text-sm text-gray-500 hover:text-gray-700">
              Отмена
            </button>
            <button
              onClick={saveOrder}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              <Save size={13} /> {saving ? 'Сохраняем…' : 'Сохранить порядок'}
            </button>
          </div>
        </div>
      )}

      {/* View mode tabs */}
      {items.length > 0 && (
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <TabBtn active={viewMode === 'statements'} onClick={() => setViewMode('statements')}>
            <FileText size={14} /> Условия
          </TabBtn>
          <TabBtn active={viewMode === 'answers'} onClick={() => setViewMode('answers')}>
            <CheckSquare size={14} /> Ответы
          </TabBtn>
          <TabBtn active={viewMode === 'solutions'} onClick={() => setViewMode('solutions')}>
            <BookOpen size={14} /> Решения
          </TabBtn>
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 space-y-2">
          <p>Подборка пуста</p>
          <Link to="/catalog" className="text-blue-600 hover:underline text-sm">
            Добавить задания из каталога
          </Link>
        </div>
      ) : tasksLoading ? (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const task = taskMap.get(item.catalog_task_id)
            return (
              <CollectionItemRow
                key={item.id}
                item={item}
                task={task}
                number={idx + 1}
                isFirst={idx === 0}
                isLast={idx === items.length - 1}
                viewMode={viewMode}
                onMoveUp={() => moveItem(idx, -1)}
                onMoveDown={() => moveItem(idx, 1)}
                onDelete={() => {
                  const next = items.filter(i => i.id !== item.id)
                  setLocalItems(next)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active:   boolean
  onClick:  () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ── Collection item row ───────────────────────────────────────────────────────

function CollectionItemRow({
  item,
  task,
  number,
  isFirst,
  isLast,
  viewMode,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  item:       TaskCollectionItem
  task:       (CatalogTask & { assets?: CatalogTaskAsset[] }) | undefined
  number:     number
  isFirst:    boolean
  isLast:     boolean
  viewMode:   ViewMode
  onMoveUp:   () => void
  onMoveDown: () => void
  onDelete:   () => void
}) {
  const { deleteItem } = useDeleteCollectionItem(item.collection_id)
  const [confirming, setConfirming] = useState(false)

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return }
    await deleteItem(item.id)
    onDelete()
  }

  if (!task) {
    return (
      <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4">
        <span className="w-7 h-7 flex items-center justify-center bg-gray-100 rounded text-xs font-medium text-gray-400">
          {number}
        </span>
        <p className="text-sm text-gray-400 flex-1">Задача недоступна</p>
        <DeleteBtn confirming={confirming} onDelete={handleDelete} />
      </div>
    )
  }

  const forceOpen =
    viewMode === 'answers'
      ? { answer: true }
      : viewMode === 'solutions'
        ? { solution: true }
        : undefined

  return (
    <div className="flex gap-2 items-start">
      {/* Reorder controls */}
      <div className="flex flex-col gap-0.5 flex-shrink-0 pt-4">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Выше"
          className="p-1 rounded text-gray-300 hover:text-gray-600 disabled:invisible transition-colors"
        >
          <ChevronUp size={15} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Ниже"
          className="p-1 rounded text-gray-300 hover:text-gray-600 disabled:invisible transition-colors"
        >
          <ChevronDown size={15} />
        </button>
      </div>

      {/* Task card */}
      <div className="flex-1 min-w-0">
        <TaskDisplayCard
          task={task}
          number={item.custom_number ? undefined : number}
          forceOpen={forceOpen}
          extraActions={
            <span className="text-xs text-gray-400">
              #{task.external_id} · {task.subject} · {task.exam_type?.toUpperCase()}
            </span>
          }
        />
      </div>

      {/* Delete */}
      <div className="flex-shrink-0 pt-4">
        <DeleteBtn confirming={confirming} onDelete={handleDelete} />
      </div>
    </div>
  )
}

function DeleteBtn({ confirming, onDelete }: { confirming: boolean; onDelete: () => void }) {
  return (
    <button
      onClick={onDelete}
      title={confirming ? 'Нажмите ещё раз' : 'Убрать задание'}
      className={`p-1.5 rounded transition-colors ${
        confirming ? 'text-red-600 hover:text-red-700' : 'text-gray-300 hover:text-red-500'
      }`}
    >
      <Trash2 size={15} />
    </button>
  )
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="h-8 bg-gray-200 rounded w-64" />
      {[1, 2, 3].map(n => <div key={n} className="h-24 bg-gray-100 rounded-xl" />)}
    </div>
  )
}
