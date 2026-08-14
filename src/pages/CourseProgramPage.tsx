import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragOverEvent,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BookOpen, Plus, ChevronDown, ChevronRight, Pencil, Trash2,
  Check, X, Calendar, Save, Loader2, ToggleLeft, ToggleRight, FileText,
  Video, Lightbulb, BookMarked, Users, GripVertical, ClipboardList, GraduationCap, BarChart3, ChevronLeft,
  Copy, Eye,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCourseProgram, type Course, type Module, type Topic } from '@/hooks/useCourseProgram'
import { useCourseHomeworkTemplates } from '@/hooks/useCourseHomeworkTemplates'
import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { CourseTopicHomeworkSection } from '@/components/courseProgram/CourseTopicHomeworkSection'
import { CourseTestResultsSection } from '@/components/courseProgram/CourseTestResultsSection'
import { CourseStudentsSection } from '@/components/courseProgram/CourseStudentsSection'
import { AddLessonTemplateToCourseModal } from '@/components/modals/AddLessonTemplateToCourseModal'
import { CopyCourseDialog } from '@/components/modals/CopyCourseDialog'
import { CopyTopicDialog } from '@/components/modals/CopyTopicDialog'
import { DeleteCourseDialog } from '@/components/modals/DeleteCourseDialog'
import { impersonate } from '@/lib/demo'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import { TopicOpenToggle } from '@/components/courseProgram/TopicOpenToggle'
import { TopicHomeworkBadge } from '@/components/courseProgram/TopicHomeworkBadge'
import { groupHomeworkByTopic, type TopicHomeworkRow } from '@/lib/topicHomeworkState'
import {
  TOPIC_MATERIAL_SECTIONS, TOPIC_SECTION_ORDER, TOPIC_SECTION_SHORT_LABELS,
  isTopicSectionVisible,
  type TopicSection,
} from '@/lib/topicMaterialItems'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'
import { groupCoursesByTemplate } from '@/lib/courseGrouping'
import { copyDisplayTitle } from '@/lib/courseDisplayName'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'

// ─── Inline editable text ────────────────────────────────────────────────────
function InlineEdit({
  value, onSave, className = '', placeholder = 'Введите название', startEditing = false, onCancelCreate,
}: { value: string; onSave: (v: string) => Promise<void>; className?: string; placeholder?: string; startEditing?: boolean; onCancelCreate?: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(startEditing)
  const [text, setText]       = useState(value)
  const [saving, setSaving]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setText(value) }, [value])
  useEffect(() => { if (startEditing) { setText(value); setEditing(true) } }, [startEditing, value])

  async function cancelEdit() {
    if (startEditing && onCancelCreate && text.trim() === value.trim()) {
      await onCancelCreate()
      return
    }
    setEditing(false)
    setText(value)
  }

  async function commit() {
    if (!text.trim()) {
      if (startEditing && onCancelCreate) {
        await onCancelCreate()
        return
      }
      setEditing(false)
      setText(value)
      return
    }
    if (text === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(text.trim())
      toast.success('Название сохранено')
      setEditing(false)
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code ?? '') : ''
      if (code === '42501' || code.startsWith('PGRST')) {
        toast.error('Недостаточно прав для сохранения названия')
      } else {
        console.error('Failed to save title', e)
        toast.error('Не удалось сохранить название')
      }
      setText(value)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div ref={containerRef} className="flex min-w-0 flex-col items-start gap-1">
        <div className="flex w-full min-w-0 items-center gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={e => {
              const nextTarget = e.relatedTarget as HTMLElement | null
              if (nextTarget && containerRef.current?.contains(nextTarget)) return
              void commit()
            }}
            onKeyDown={e => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') void cancelEdit() }}
            className={cn('min-w-0 flex-1 border border-primary-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400', className)}
          />
          <div className="flex shrink-0 items-center gap-1">
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { void commit() }}
              disabled={saving}
              title="Сохранить (Enter)"
              className="rounded-md p-1 text-green-500 hover:bg-green-50 hover:text-green-700"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { void cancelEdit() }}
              title="Отменить (Esc)"
              className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <span className="text-[11px] text-gray-400">Enter — сохранить, Esc — отменить</span>
      </div>
    )
  }

  return (
    <span
      className={cn('cursor-pointer hover:text-primary-600 transition-colors group', className)}
      onClick={() => { setText(value); setEditing(true) }}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
      <Pencil size={11} className="inline ml-1.5 opacity-40 md:opacity-0 md:group-hover:opacity-40 transition-opacity" />
    </span>
  )
}

// ─── Topic row ───────────────────────────────────────────────────────────────
interface TopicHomeworkV2Summary {
  templateCount: number
  assignmentCount: number
  lastAssignedAt: string | null
}

type CourseLayoutRow = { module_id: string; topic_ids: string[] }
const SELECT_PAGE_SIZE = 1000

function formatHomeworkCountMessage(count: number) {
  return `В теме ${count} ${count === 1 ? 'шаблон или назначение ДЗ' : 'шаблона или назначения ДЗ'}. Сначала перенесите или удалите их во вкладке «Домашние задания».`
}

async function fetchAllPagedRows<T>(buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + SELECT_PAGE_SIZE - 1)
    if (error) throw new Error(error.message ?? 'Не удалось загрузить данные')
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < SELECT_PAGE_SIZE) break
  }
  return rows
}

function withNormalizedTopicLayout(modules: Module[]): Module[] {
  return modules.map((module, moduleIndex) => ({
    ...module,
    order_index: module.order_index ?? moduleIndex,
    topics: module.topics.map((topic, topicIndex) => ({
      ...topic,
      module_id: module.id,
      order_index: topicIndex,
    })),
  }))
}

function buildTopicLayout(modules: Module[]): CourseLayoutRow[] {
  return modules.map(module => ({
    module_id: module.id,
    topic_ids: module.topics.map(topic => topic.id),
  }))
}

function getModuleDisplayNumber(moduleIndex: number) {
  return moduleIndex + 1
}

function getTopicDisplayNumber(moduleIndex: number, topicIndex: number) {
  return `${getModuleDisplayNumber(moduleIndex)}.${topicIndex + 1}`
}

function moveTopicBetweenModules(
  modules: Module[],
  activeTopicId: string,
  overId: string,
  opts?: {
    placeAfter?: boolean
  }
): Module[] {
  const sourceModule = modules.find(module => module.topics.some(topic => topic.id === activeTopicId))
  if (!sourceModule) return modules

  const targetModule = modules.find(module =>
    module.id === overId || module.topics.some(topic => topic.id === overId),
  )
  if (!targetModule) return modules

  const sourceIndex = sourceModule.topics.findIndex(topic => topic.id === activeTopicId)
  if (sourceIndex < 0) return modules

  const draggedTopic = sourceModule.topics[sourceIndex]

  return withNormalizedTopicLayout(modules.map(module => {
    if (module.id === sourceModule.id && module.id === targetModule.id) {
      const nextTopics = [...module.topics]
      nextTopics.splice(sourceIndex, 1)
      const targetIndex = overId === module.id
        ? nextTopics.length
        : nextTopics.findIndex(topic => topic.id === overId)
      const insertIndex = targetIndex < 0
        ? nextTopics.length
        : opts?.placeAfter
          ? targetIndex + 1
          : targetIndex
      const boundedInsertIndex = Math.max(0, Math.min(insertIndex, nextTopics.length))
      const currentIndex = nextTopics.findIndex(topic => topic.id === activeTopicId)
      if (currentIndex === boundedInsertIndex) return module
      nextTopics.splice(boundedInsertIndex, 0, { ...draggedTopic, module_id: module.id })
      return { ...module, topics: nextTopics }
    }

    if (module.id === sourceModule.id) {
      return {
        ...module,
        topics: module.topics.filter(topic => topic.id !== activeTopicId),
      }
    }

    if (module.id === targetModule.id) {
      const nextTopics = [...module.topics]
      const targetIndex = overId === module.id
        ? nextTopics.length
        : nextTopics.findIndex(topic => topic.id === overId)
      const insertIndex = targetIndex < 0
        ? nextTopics.length
        : opts?.placeAfter
          ? targetIndex + 1
          : targetIndex
      const boundedInsertIndex = Math.max(0, Math.min(insertIndex, nextTopics.length))
      nextTopics.splice(boundedInsertIndex, 0, { ...draggedTopic, module_id: module.id })
      return { ...module, topics: nextTopics }
    }

    return module
  }))
}

function findTopicPosition(modules: Module[], topicId: string) {
  for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
    const topicIndex = modules[moduleIndex].topics.findIndex(topic => topic.id === topicId)
    if (topicIndex >= 0) return { moduleIndex, topicIndex }
  }
  return null
}

function findModuleByOverId(modules: Module[], overId: string) {
  return modules.find(module =>
    module.id === overId || module.topics.some(topic => topic.id === overId),
  ) ?? null
}

function shouldPlaceAfter(overId: string, event: Pick<DragOverEvent, 'active' | 'over'> | Pick<DragEndEvent, 'active' | 'over'>) {
  if (!event.over || overId === String(event.active.id)) return false
  const overType = event.over.data.current?.type
  if (overType !== 'topic') return false

  const translatedTop = event.active.rect.current.translated?.top
  const translatedHeight = event.active.rect.current.translated?.height
  if (translatedTop == null || translatedHeight == null) return false

  const activeMiddleY = translatedTop + translatedHeight / 2
  const overMiddleY = event.over.rect.top + event.over.rect.height / 2
  return activeMiddleY > overMiddleY
}

function sameLayout(a: Module[], b: Module[]) {
  const aLayout = buildTopicLayout(a)
  const bLayout = buildTopicLayout(b)
  return JSON.stringify(aLayout) === JSON.stringify(bLayout)
}

function TopicDragOverlay({ topic, topicNumber }: { topic: Topic; topicNumber: string }) {
  return (
    <div className="w-[min(720px,calc(100vw-2rem))] rounded-2xl border border-primary-200 bg-white px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-primary-200 bg-primary-50 text-primary-500">
          <GripVertical size={15} />
        </div>
        <div className="h-2.5 w-2.5 rounded-full bg-primary-400 shrink-0" />
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span className="pt-1 text-sm font-medium tabular-nums text-gray-400 shrink-0">{topicNumber}</span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-gray-900">{topic.title}</div>
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── HW table (view mode) ────────────────────────────────────────────────────
function HwTable({
  modules, homeworkByTopic, homeworkStateByTopic, onOpenTopic, onOpenHomeworkTab, onToggleTopicOpen,
}: {
  modules: Module[]
  homeworkByTopic: Record<string, TopicHomeworkV2Summary>
  /** Состояние ДЗ темы: есть ли задание, выдано ли, до какого числа (§117). */
  homeworkStateByTopic: Record<string, TopicHomeworkRow[]>
  onOpenTopic: (topic: Topic, moduleTitle: string) => void
  onOpenHomeworkTab: () => void
  onToggleTopicOpen: (topicId: string, isOpen: boolean) => Promise<void>
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Тема</th>
            <th className="px-3 py-3 text-center w-24 text-xs font-medium text-gray-500">Шаблоны</th>
            <th className="px-3 py-3 text-center w-24 text-xs font-medium text-gray-500">Назначения</th>
            <th className="px-3 py-3 text-center w-28 text-xs font-medium text-gray-500">Последнее назначение</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((mod, moduleIndex) => (
            <Fragment key={mod.id}>
              <tr key={`mod-${mod.id}`} className="bg-primary-50/50">
                <td colSpan={6} className="px-4 py-2">
                  <span className="mr-2 text-xs font-medium tabular-nums text-primary-400">{getModuleDisplayNumber(moduleIndex)}.</span>
                  <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{mod.title}</span>
                  <span className="text-xs text-primary-400 ml-2">{mod.topics.length} тем</span>
                </td>
              </tr>

              {mod.topics.map((topic, ti) => {
                const hw = homeworkByTopic[topic.id]

                return (
                  <tr
                    key={topic.id}
                    className={cn(
                      'border-b border-gray-100 transition-colors',
                      ti % 2 !== 0 && 'bg-gray-50/30'
                    )}
                  >
                    {/* Clickable topic name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onOpenTopic(topic, mod.title)}
                          className="group flex items-center gap-1.5 text-left hover:text-primary-600 transition-colors"
                        >
                          <ChevronRight size={13} className="text-gray-300 group-hover:text-primary-400 shrink-0 transition-colors" />
                          <span className="text-xs font-medium tabular-nums text-gray-400 shrink-0">{getTopicDisplayNumber(moduleIndex, ti)}</span>
                          <span className="text-sm text-gray-800 group-hover:text-primary-600 group-hover:underline underline-offset-2">
                            {topic.title}
                          </span>
                        </button>
                        <TopicOpenToggle topic={topic} onToggle={v => onToggleTopicOpen(topic.id, v)} />
                        <TopicHomeworkBadge rows={homeworkStateByTopic[topic.id] ?? []} />
                        {hw && (
                          <button
                            onClick={onOpenHomeworkTab}
                            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:bg-primary-50 hover:text-primary-700"
                          >
                            ДЗ
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-3 text-center">
                      {hw ? <span className="text-sm font-semibold text-gray-800">{hw.templateCount}</span> : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {hw ? <span className="text-sm font-semibold text-gray-800">{hw.assignmentCount}</span> : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {hw?.lastAssignedAt ? (
                        <span className="text-xs text-gray-500">
                          {new Date(hw.lastAssignedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Edit mode: topic row with inline editing controls
function TopicRowEdit({
  topic, topicNumber, onSave, onDelete, onOpenMaterials, onCopyTopic, homeworkCount, homeworkRows = [], moduleTitle, startEditing = false, onCancelCreate, dragHandle, isDragging,
}: {
  topic: Topic
  topicNumber: string
  moduleTitle: string
  homeworkCount?: number
  /** Строки ДЗ темы из общего запроса по курсу (§117). */
  homeworkRows?: TopicHomeworkRow[]
  startEditing?: boolean
  onCancelCreate?: () => Promise<void>
  onSave: (id: string, v: Partial<Topic>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpenMaterials: (topic: Topic, moduleTitle: string) => void
  onCopyTopic: (topic: Topic) => void
  dragHandle?: {
    listeners: ReturnType<typeof useSortable>['listeners']
    attributes: ReturnType<typeof useSortable>['attributes']
    disabled?: boolean
  }
  isDragging?: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const deleteBlockedMessage = homeworkCount && homeworkCount > 0 ? formatHomeworkCountMessage(homeworkCount) : null

  return (
    <div className={cn(
      'rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]',
      isDragging && 'opacity-70 ring-2 ring-primary-200'
    )}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 overflow-visible">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-visible">
          {dragHandle && (
            <button
              type="button"
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              disabled={dragHandle.disabled}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Перетащить тему"
            >
              <GripVertical size={15} />
            </button>
          )}
          <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary-400" />
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
              <span className="shrink-0 text-sm font-medium tabular-nums text-gray-400">{topicNumber}</span>
              <div className="min-w-0 flex-1 overflow-visible">
                <InlineEdit
                  value={topic.title}
                  onSave={v => onSave(topic.id, { title: v })}
                  className="block w-full truncate text-base font-semibold text-gray-900"
                  startEditing={startEditing}
                  onCancelCreate={onCancelCreate}
                />
              </div>
              <TopicOpenToggle topic={topic} onToggle={v => onSave(topic.id, { is_open: v })} />
              <TopicHomeworkBadge rows={homeworkRows} />
            </div>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Баллы</span>
            <span className="rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-gray-500 shadow-sm">Макс.</span>
            <input
              type="number"
              defaultValue={topic.max_score}
              min={1}
              max={100}
              onBlur={e => onSave(topic.id, { max_score: parseInt(e.target.value) || 100 })}
              className="h-9 w-20 rounded-xl border border-gray-200 bg-white px-3 text-center text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <span className="text-[11px] font-medium text-gray-500">б.</span>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenMaterials(topic, moduleTitle)} className="min-h-9 px-3 text-sm">
              <FileText size={15} />
              Редактировать тему
            </Button>
            <button
              type="button"
              onClick={() => onCopyTopic(topic)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:border-primary-300 hover:text-primary-600"
              title="Скопировать тему в другой курс"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={async () => { setDeleting(true); try { await onDelete(topic.id) } finally { setDeleting(false) } }}
              disabled={deleting || !!deleteBlockedMessage}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-60"
              title={deleteBlockedMessage || 'Удалить тему'}
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SortableTopicRow({
  topic,
  topicNumber,
  moduleTitle,
  homeworkCount,
  homeworkRows,
  startEditing,
  onCancelCreate,
  onSave,
  onDelete,
  onOpenMaterials,
  onCopyTopic,
  isReordering,
}: {
  topic: Topic
  topicNumber: string
  moduleTitle: string
  homeworkCount?: number
  homeworkRows?: TopicHomeworkRow[]
  startEditing?: boolean
  onCancelCreate?: () => Promise<void>
  onSave: (id: string, v: Partial<Topic>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpenMaterials: (topic: Topic, moduleTitle: string) => void
  onCopyTopic: (topic: Topic) => void
  isReordering: boolean
}) {
  const sortable = useSortable({
    id: topic.id,
    data: {
      type: 'topic',
      moduleId: topic.module_id,
      topicId: topic.id,
    },
    disabled: isReordering,
  })

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    >
      <TopicRowEdit
        topic={topic}
        topicNumber={topicNumber}
        moduleTitle={moduleTitle}
        homeworkCount={homeworkCount}
        homeworkRows={homeworkRows}
        startEditing={startEditing}
        onCancelCreate={onCancelCreate}
        onSave={onSave}
        onDelete={onDelete}
        onOpenMaterials={onOpenMaterials}
        onCopyTopic={onCopyTopic}
        dragHandle={{
          listeners: sortable.listeners,
          attributes: sortable.attributes,
          disabled: isReordering,
        }}
        isDragging={sortable.isDragging}
      />
    </div>
  )
}

// ─── Module card ─────────────────────────────────────────────────────────────
function ModuleCard({
  module, moduleNumber, canEdit, editMode, onSaveModule, onDeleteModule, onSaveTopic, onDeleteTopic, onAddTopic, onOpenMaterials, onCopyTopic, homeworkCountsByTopic, homeworkStateByTopic, creatingTopicId, onCancelCreateTopic, startEditingModule, onCancelCreateModule, isReordering,
}: {
  module: Module
  moduleNumber: number
  canEdit: boolean
  editMode: boolean
  homeworkCountsByTopic: Record<string, number>
  homeworkStateByTopic: Record<string, TopicHomeworkRow[]>
  creatingTopicId: string | null
  onCancelCreateTopic: (topicId: string) => Promise<void>
  startEditingModule: boolean
  onCancelCreateModule: (moduleId: string) => Promise<void>
  onSaveModule: (id: string, title: string) => Promise<void>
  onDeleteModule: (id: string) => Promise<void>
  onSaveTopic: (id: string, v: Partial<Topic>) => Promise<void>
  onDeleteTopic: (id: string) => Promise<void>
  onAddTopic: (moduleId: string) => Promise<void>
  onOpenMaterials: (topic: Topic, moduleTitle: string) => void
  onCopyTopic: (topic: Topic) => void
  isReordering: boolean
}) {
  const [open,     setOpen]     = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [adding,   setAdding]   = useState(false)
  const { setNodeRef, isOver } = useDroppable({
    id: module.id,
    data: { type: 'module', moduleId: module.id },
    disabled: isReordering,
  })

  async function handleDelete() {
    if (!confirm(`Удалить модуль «${module.title}» и все его темы?`)) return
    setDeleting(true)
    try { await onDeleteModule(module.id) } finally { setDeleting(false) }
  }

  async function handleAddTopic() {
    setAdding(true)
    try { await onAddTopic(module.id) } finally { setAdding(false) }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Module header */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100',
        canEdit && 'cursor-default'
      )}>
        <button onClick={() => setOpen(o => !o)} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white hover:text-gray-600 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="flex min-w-0 flex-1 items-start gap-2 overflow-visible">
          <span className="pt-0.5 text-sm font-medium tabular-nums text-gray-400 shrink-0">{moduleNumber}.</span>
          <div className="min-w-0 flex-1 overflow-visible">
            {canEdit ? (
              <InlineEdit
                value={module.title}
                onSave={v => onSaveModule(module.id, v)}
                className="truncate font-semibold"
                startEditing={startEditingModule}
                onCancelCreate={() => onCancelCreateModule(module.id)}
              />
            ) : (
              <span className="truncate font-semibold text-gray-800 text-sm">{module.title}</span>
            )}
          </div>
          <Badge variant="default" className="text-[11px] tabular-nums">{module.topics.length} тем</Badge>
        </div>

        {canEdit && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-white hover:text-red-500 ml-1"
            title="Удалить модуль"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )}
      </div>

      {/* Topics */}
      {open && (
        <div
          ref={setNodeRef}
          className={cn('space-y-3 bg-white p-3 transition-colors', isOver && 'bg-primary-50/40')}
        >
          {module.topics.length === 0 && (
            <div className={cn('rounded-xl px-4 py-6 text-sm italic text-gray-400 border border-dashed', isOver ? 'border-primary-300 bg-primary-50 text-primary-500' : 'border-gray-200 bg-gray-50')}>
              Перетащите тему сюда
            </div>
          )}
          <SortableContext items={module.topics.map(topic => topic.id)} strategy={verticalListSortingStrategy}>
            {module.topics.map((t, topicIndex) => (
              <SortableTopicRow
                key={t.id}
                topic={t}
                topicNumber={getTopicDisplayNumber(moduleNumber - 1, topicIndex)}
                moduleTitle={module.title}
                homeworkCount={homeworkCountsByTopic[t.id] ?? 0}
                homeworkRows={homeworkStateByTopic[t.id] ?? []}
                startEditing={creatingTopicId === t.id}
                onCancelCreate={() => onCancelCreateTopic(t.id)}
                onSave={onSaveTopic}
                onDelete={onDeleteTopic}
                onOpenMaterials={onOpenMaterials}
                onCopyTopic={onCopyTopic}
                isReordering={isReordering}
              />
            ))}
          </SortableContext>

          {canEdit && (
            <div className="px-3 py-2">
              <button
                onClick={handleAddTopic}
                disabled={adding || isReordering}
                className="flex items-center gap-1.5 text-xs text-primary-500 hover:text-primary-700 transition-colors"
              >
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Добавить тему
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ─── Course settings form ─────────────────────────────────────────────────────
function CourseSettings({ course, onSave, onCopyCourse, onDeleteCourse }: { course: Course; onSave: (v: Partial<Course>) => Promise<void>; onCopyCourse: () => void; onDeleteCourse: () => void }) {
  const [form, setForm]   = useState({ ...course })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [publishing, setPublishing] = useState(false)

  const [dateErr, setDateErr] = useState<string | null>(null)

  function validateDates(): string | null {
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      return 'Дата окончания должна быть позже даты старта'
    }
    if (form.enrollment_open_until && form.start_date && form.enrollment_open_until > form.start_date) {
      return 'Дедлайн записи не может быть позже старта курса'
    }
    return null
  }

  async function handleSave() {
    const err = validateDates()
    if (err) { setDateErr(err); return }
    setDateErr(null)
    setSaving(true)
    try {
      await onSave({
        title:                 form.title,
        description:           form.description,
        price:                 form.price,
        duration_weeks:        form.duration_weeks,
        is_active:             form.is_active,
        is_template:           form.is_template,
        start_date:            form.start_date || null,
        end_date:              form.end_date   || null,
        enrollment_open_until: form.enrollment_open_until || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  // Live availability hint
  const availability = (() => {
    const today = new Date().toISOString().slice(0, 10)
    if (!form.start_date && !form.end_date) return null
    if (form.start_date && today < form.start_date)
      return { kind: 'info' as const, text: `Курс станет доступен ${formatDateLong(form.start_date)}` }
    if (form.end_date && today > form.end_date)
      return { kind: 'warn' as const, text: `Курс завершился ${formatDateLong(form.end_date)}` }
    return { kind: 'ok' as const, text: 'Курс активен прямо сейчас' }
  })()

  return (
    <div className="space-y-5 max-w-lg">
      {/* Черновик снимается отдельной кнопкой, а не переключателем «активен».
          Это разные вещи: неактивный курс просто закрыт, черновик же ещё и
          недоступен для записи — сняв только переключатель, преподаватель
          получил бы курс, на который никто не может записаться, и не понял бы
          почему. */}
      {form.is_draft && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Это черновик</p>
          <p className="mt-1 text-sm text-amber-800">
            Ученики курс не видят и записаться на него не могут. Проверьте программу и материалы,
            затем опубликуйте.
          </p>
          <Button
            className="mt-3"
            loading={publishing}
            onClick={async () => {
              setPublishing(true)
              try {
                await onSave({ is_draft: false, is_active: true })
                setForm(f => ({ ...f, is_draft: false, is_active: true }))
              } finally {
                setPublishing(false)
              }
            }}
          >
            Опубликовать курс
          </Button>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Название курса</label>
        <input
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
        <textarea
          rows={3}
          value={form.description || ''}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Предмет</label>
          <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-500">
            {SUBJECT_LABELS[form.subject] || form.subject}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Тип экзамена</label>
          <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-500">
            {EXAM_LABELS[form.exam_type] || form.exam_type}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Цена (₽)</label>
          <input
            type="number"
            value={form.price}
            onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Длительность (нед.)</label>
          <input
            type="number"
            value={form.duration_weeks}
            onChange={e => setForm(f => ({ ...f, duration_weeks: parseInt(e.target.value) || 36 }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* ── Сроки доступности ──────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900">Сроки доступности</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Дата старта</label>
            <input
              type="date"
              value={form.start_date || ''}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value || null }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Дата окончания</label>
            <input
              type="date"
              value={form.end_date || ''}
              onChange={e => setForm(f => ({ ...f, end_date: e.target.value || null }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Дедлайн записи <span className="text-gray-400 font-normal">(необязательно)</span>
          </label>
          <input
            type="date"
            value={form.enrollment_open_until || ''}
            onChange={e => setForm(f => ({ ...f, enrollment_open_until: e.target.value || null }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            После этой даты новые ученики не смогут записаться. Оставьте пустым — запись всегда открыта.
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-3">
          <QuickDateBtn label="Учебный год 2025/26" onClick={() => setForm(f => ({ ...f, start_date: '2025-09-01', end_date: '2026-05-31' }))} />
          <QuickDateBtn label="Учебный год 2026/27" onClick={() => setForm(f => ({ ...f, start_date: '2026-09-01', end_date: '2027-05-31' }))} />
          <QuickDateBtn label="Очистить даты"       onClick={() => setForm(f => ({ ...f, start_date: null, end_date: null, enrollment_open_until: null }))} />
        </div>

        {dateErr && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{dateErr}</div>
        )}

        {availability && (
          <div className={cn(
            'flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-sm font-medium',
            availability.kind === 'ok'   ? 'bg-green-50 text-green-700' :
            availability.kind === 'warn' ? 'bg-gray-100 text-gray-600'   :
                                           'bg-blue-50 text-blue-700'
          )}>
            <Calendar size={14} />{availability.text}
          </div>
        )}
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
          className={cn('transition-colors', form.is_active ? 'text-green-500' : 'text-gray-400')}
        >
          {form.is_active ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
        </button>
        <span className="text-sm text-gray-700">
          Курс <strong>{form.is_active ? 'активен' : 'неактивен'}</strong>
        </span>
      </div>

      {/* Шаблон — не право и не состояние доступа, а роль курса в работе школы:
          из каркаса копируют курсы групп. Признак ставится руками, чтобы
          будущие шаблоны размечались без миграций (§113). */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          data-testid="course-is-template"
          checked={form.is_template}
          onChange={e => setForm(f => ({ ...f, is_template: e.target.checked }))}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-gray-700">
          Это шаблон (каркас курса)
          <span className="mt-0.5 block text-xs text-gray-400">
            Шаблон — каркас. Учеников зачисляют в копии, не в шаблон.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button onClick={handleSave} loading={saving}>
          <Save size={15} className="mr-1.5" />Сохранить
        </Button>
        {saved && <span className="text-sm text-green-600 font-medium">Сохранено ✓</span>}
        {/* Многоточие — не украшение: оно отличает кнопку, открывающую окно, от
            кнопки внутри окна, которая действительно создаёт копию. Пока обе
            назывались одинаково, было непонятно, сработало нажатие или нет. */}
        <Button variant="secondary" onClick={onCopyCourse} className="ml-auto">
          <Copy size={15} className="mr-1.5" />Скопировать курс…
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Копия получит все модули, темы и материалы. Ученики и ссылка-приглашение не переносятся.
      </p>

      {/* Удаление доступно только для архива и черновиков. Действующий курс
          придётся сначала убрать в архив — лишний шаг стоит дёшево, а промах
          по рабочему курсу не стоит ничего вернуть. */}
      {(!form.is_active || form.is_draft) && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50/50 px-4 py-3">
          <p className="text-sm font-semibold text-red-900">Удалить курс</p>
          <p className="mt-1 text-sm text-red-800">
            Вместе с курсом исчезнут его темы, материалы, домашние задания и сданные работы.
            Перед удалением покажем, что именно потеряется.
          </p>
          <Button variant="danger" className="mt-3" onClick={onDeleteCourse}>
            <Trash2 size={15} className="mr-1.5" />Удалить курс…
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Materials matrix ─────────────────────────────────────────────────────────
/**
 * Цвет колонки. Список рубрик, порядок и подписи — из общего места (§100);
 * здесь только оформление. Record не даёт забыть новую рубрику.
 */
const MAT_COL_COLOR: Record<TopicSection, string> = {
  theory: 'text-purple-500',
  notes: 'text-blue-500',
  tasks: 'text-orange-500',
  task_solution: 'text-teal-500',
  worksheet_tasks: 'text-sky-500',
  homework: 'text-yellow-500',
  solution: 'text-green-500',
  worksheet_homework: 'text-cyan-500',
  video: 'text-red-500',
  test: 'text-indigo-500',
}

const MAT_COL_ICON: Record<TopicSection, React.ReactNode> = {
  theory: <BookOpen size={13} />,
  notes: <BookMarked size={13} />,
  tasks: <ClipboardList size={13} />,
  task_solution: <Check size={13} />,
  worksheet_tasks: <FileText size={13} />,
  homework: <Lightbulb size={13} />,
  solution: <Check size={13} />,
  worksheet_homework: <FileText size={13} />,
  video: <Video size={13} />,
  test: <BarChart3 size={13} />,
}

// Скрытая рубрика не должна занимать колонку в матрице: перечень един, а
// показ решает `TOPIC_SECTIONS_HIDDEN`.
const MAT_COLS = TOPIC_SECTION_ORDER.filter(isTopicSectionVisible).map(type => ({
  type,
  label: TOPIC_SECTION_SHORT_LABELS[type],
  icon: MAT_COL_ICON[type],
  color: MAT_COL_COLOR[type],
}))

function MaterialsMatrix({
  courseId, modules, onOpenTopic, onGoToProgram, onToggleTopicOpen, refreshKey = 0,
}: {
  courseId: string
  modules: Module[]
  onOpenTopic: (topic: Topic, moduleTitle: string) => void
  onGoToProgram: () => void
  onToggleTopicOpen: (topicId: string, isOpen: boolean) => Promise<void>
  /** Меняется при закрытии модалки темы — матрица перечитывает заполненность. */
  refreshKey?: number
}) {
  const [matMap, setMatMap] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!courseId || !modules.length) {
      setMatMap({})
      setError(null)
      setLoading(false)
      return
    }
    const topicIds = modules.flatMap(m => m.topics.map(t => t.id))
    if (!topicIds.length) {
      setMatMap({})
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [materialItems, homeworkRows, testRows] = await Promise.all([
          // Query 1: topic_material_items with pagination
          fetchAllPagedRows<{ topic_id: string; kind: string; section: string | null }>(async (from, to) =>
            await supabase
              .from('topic_material_items')
              .select('topic_id, kind, section')
              .in('topic_id', topicIds)
              .range(from, to)
          ),
          // Query 2: topic_homework (no pagination)
          (async () => {
            const { data, error } = await supabase
              .from('topic_homework')
              .select('topic_id')
              .in('topic_id', topicIds)
            if (error) throw new Error(error.message ?? 'Не удалось загрузить домашние задания')
            return (data as { topic_id: string }[] | null) || []
          })(),
          // Query 3: привязки тестов банка к темам
          (async () => {
            const { data, error } = await supabase
              .from('topic_test_assignments')
              .select('topic_id')
              .in('topic_id', topicIds)
            if (error) throw new Error(error.message ?? 'Не удалось загрузить тесты')
            return (data as { topic_id: string }[] | null) || []
          })(),
        ])

        const map: Record<string, Set<string>> = {}

        // Process topic_material_items
        for (const row of materialItems) {
          if (!map[row.topic_id]) map[row.topic_id] = new Set()
          // Список секций берём из общего места, а не переписываем строкой:
          // с §95 их семь, и третья копия перечня разъехалась бы первой.
          if (row.section && (TOPIC_MATERIAL_SECTIONS as readonly string[]).includes(row.section)) {
            map[row.topic_id].add(row.section)
          }
          // If kind === 'video' -> add('video')
          if (row.kind === 'video') {
            map[row.topic_id].add('video')
          }
        }

        // Process topic_homework
        for (const row of homeworkRows) {
          if (!map[row.topic_id]) map[row.topic_id] = new Set()
          map[row.topic_id].add('homework')
        }

        // Process topic_tests
        for (const row of testRows) {
          if (!map[row.topic_id]) map[row.topic_id] = new Set()
          map[row.topic_id].add('test')
        }

        if (cancelled) return
        setMatMap(map)
      } catch (e) {
        if (cancelled) return
        console.error('Failed to load topic materials', e)
        setMatMap({})
        setError('Не удалось загрузить материалы курса')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [courseId, modules, refreshKey])

  const allTopics = modules.flatMap(m => m.topics.map(t => ({ topic: t, moduleTitle: m.title })))
  const totalCells = allTopics.length * MAT_COLS.length
  const filledCells = allTopics.reduce((s, { topic }) =>
    s + MAT_COLS.filter(c => matMap[topic.id]?.has(c.type)).length, 0)
  const fillPct = totalCells > 0 ? Math.round(filledCells / totalCells * 100) : 0
  const hasAnyMaterials = filledCells > 0

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" />Загрузка…
    </div>
  )

  if (allTopics.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center">
        <p className="text-sm font-medium text-gray-700">Материалов пока нет</p>
        <p className="mt-1 text-sm text-gray-400">Сначала добавьте в курс модули и темы, чтобы их можно было наполнить материалами.</p>
        <Button className="mt-4" onClick={onGoToProgram}>
          <Plus size={15} className="mr-1.5" />
          Перейти к программе
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {!error && !hasAnyMaterials && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-600">Материалов пока нет. Нажмите на строку темы, чтобы добавить конспект, теорию, видео или ссылку.</p>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', fillPct >= 80 ? 'bg-green-500' : fillPct >= 50 ? 'bg-yellow-400' : 'bg-red-400')}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-700 shrink-0">{filledCells} / {totalCells} заполнено ({fillPct}%)</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-56">Тема</th>
              {MAT_COLS.map(c => (
                <th key={c.type} className="px-2 py-3 text-center">
                  <div className={cn('flex flex-col items-center gap-0.5', c.color)}>
                    {c.icon}
                    <span className="text-[10px] font-medium text-gray-500">{c.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map(mod => (
              <Fragment key={mod.id}>
                {/* Module header row */}
                <tr className="bg-primary-50/50">
                  <td colSpan={MAT_COLS.length + 1} className="px-4 py-2">
                    <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{mod.title}</span>
                    <span className="text-xs text-primary-400 ml-2">
                      {mod.topics.reduce((s, t) => s + (matMap[t.id]?.size || 0), 0)} / {mod.topics.length * MAT_COLS.length}
                    </span>
                  </td>
                </tr>
                {/* Topic rows */}
                {mod.topics.map((topic, ti) => (
                  <tr
                    key={topic.id}
                    className={cn(
                      'border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer',
                      ti % 2 === 0 ? '' : 'bg-gray-50/30'
                    )}
                    onClick={() => onOpenTopic(topic, mod.title)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-800 hover:text-primary-600 transition-colors">{topic.title}</span>
                        <TopicOpenToggle topic={topic} onToggle={v => onToggleTopicOpen(topic.id, v)} />
                      </div>
                    </td>
                    {MAT_COLS.map(c => {
                      const has = matMap[topic.id]?.has(c.type)
                      return (
                        <td key={c.type} className="px-2 py-2.5 text-center">
                          {has
                            ? <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 rounded-full">
                                <Check size={12} className="text-green-600" />
                              </span>
                            : <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full">
                                <X size={12} className="text-gray-300" />
                              </span>
                          }
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
/** Вкладки курса. Значение живёт в адресе, поэтому список нужен и для разбора. */
const COURSE_TABS = ['program', 'materials', 'homework', 'testresults', 'students', 'settings'] as const
type CourseTab = typeof COURSE_TABS[number]

/**
 * Карточка курса в списке. Именно ссылка, а не кнопка: браузер сам умеет
 * открывать ссылки в новой вкладке, показывать адрес в статусной строке и
 * копировать его по правому клику. Кнопка всё это ломает.
 */
function CourseCard({ course, ownerLabel }: { course: Course; ownerLabel?: string | null }) {
  return (
    <Link
      to={`/course-program?courseId=${course.id}`}
      data-testid={course.is_template ? 'course-card-template' : 'course-card'}
      className={cn(
        'group flex min-h-[92px] flex-col justify-between rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        // Шаблон видно ещё до чтения бейджа: рамка заметнее, фон холоднее.
        course.is_template ? 'border-primary-200 bg-primary-50/40' : 'border-gray-100 bg-white',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-snug text-gray-900 group-hover:text-primary-700">
          {course.title}
        </span>
        {course.is_template ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
            шаблон
          </span>
        ) : course.is_draft ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            черновик
          </span>
        ) : !course.is_active ? (
          <span className="mt-0.5 shrink-0 text-xs text-gray-400">архив</span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="info" className="text-xs">{SUBJECT_LABELS[course.subject] || course.subject}</Badge>
        <Badge variant="default" className="text-xs">{EXAM_LABELS[course.exam_type] || course.exam_type}</Badge>
      </div>
      {/* Чей курс — тихой строкой внизу. Не плашкой: в списке из десятка
          карточек громкая метка на каждой превращается в шум. */}
      {ownerLabel && (
        <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-400">
          <GraduationCap size={12} className="shrink-0" />
          <span className="truncate">{ownerLabel}</span>
        </span>
      )}
    </Link>
  )
}

/**
 * Ветвь копий под карточкой шаблона: аккордеон с коротким именем каждой копии.
 *
 * Копия — не полноразмерная карточка, а строка: имя у неё короткое (общая с
 * шаблоном часть отброшена, см. `copyDisplayTitle`), а полное название висит
 * подсказкой. Так три шаблона со своими группами помещаются на один экран, а
 * не на три — ровно то, на что смотрел владелец 10.08 (§114).
 *
 * По умолчанию РАЗВЁРНУТО: сейчас у каждого шаблона по одной копии, и
 * свёрнутый список прятал бы ровно то, ради чего затевалась группировка.
 * Состояние живёт в памяти страницы: ни localStorage, ни sessionStorage —
 * цена ошибки выше пользы (правило §105 про хранилища).
 */
function CourseCopiesShelf({ template, copies }: { template: Course; copies: Course[] }) {
  const [open, setOpen] = useState(true)

  return (
    <div
      data-testid={`course-copies-of-${template.id}`}
      className="ml-3 rounded-xl border-l-2 border-primary-100 bg-primary-50/40 py-1.5 pl-3 pr-2"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-xs text-gray-500 transition-colors hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
        Копии · {copies.length}
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {copies.map(c => (
            <Link
              key={c.id}
              to={`/course-program?courseId=${c.id}`}
              // Полное название — подсказкой: короткое имя не должно мешать
              // убедиться, что это за курс, не открывая его.
              title={c.title}
              /*
                Белая карточка-кнопка на голубоватой полке (§115). Строкой без
                фона копия не читалась как нажимаемая — владелец на живом
                просмотре не понял, ссылка это или просто текст. Высота
                остаётся строчной: полноразмерная плитка сломала бы ряд
                шаблонов, ради которого делался §114.
              */
              className="group/copy flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 transition-all hover:border-primary-300 hover:text-primary-700 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{copyDisplayTitle(c.title, template.title)}</span>
              {c.is_draft && (
                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  черновик
                </span>
              )}
              {/* Стрелка — признак перехода: по ней видно, что карточка ведёт
                  в курс, а не просто подписана. */}
              <ChevronRight
                size={14}
                data-testid="course-copy-arrow"
                className="shrink-0 text-gray-300 transition-colors group-hover/copy:text-primary-400"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function CourseProgramPage() {
  const profile = useAuthStore(s => s.profile)
  const { readOnly } = useMyTeachingScope()
  // Роль `curator` из списка убрана: с 2026-08-05 куратор программу читает, но
  // не правит, и база это подтверждает (`course_is_teacher_staff`). Оставлять
  // её значило бы рисовать легаси-куратору кнопки, каждая из которых кончается
  // ошибкой 42501. `readOnly` закрывает вторую половину: ученика, которого
  // назначили куратором, — у него в профиле `student`, и по списку ролей он и
  // так не проходит, но правило должно быть записано, а не выведено.
  const canEdit = !readOnly
    && !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const isAdmin = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const isPlatformAdmin = !!profile?.role && ['admin', 'owner'].includes(profile.role)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const {
    courses, loading, reload: reloadCourses,
    loadModules, saveCourse, createCourse,
    saveModule, createModule, deleteModule,
    saveTopic, createTopic, deleteTopic,
  } = useCourseProgram()

  const [searchParams, setSearchParams] = useSearchParams()

  // Курс и вкладка живут ТОЛЬКО в адресе, без копии в useState. Так карточка
  // курса может быть обычной ссылкой: Ctrl+клик открывает курс в новой вкладке,
  // «назад» возвращает к списку, F5 остаётся на месте. Раньше выбор дублировался
  // в состоянии и синхронизировался с адресом двумя эффектами — именно в этой
  // паре и жил бесконечный цикл перерисовки, который ломал переходы.
  const selectedId = searchParams.get('courseId')

  const selectCourse = useCallback((id: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('courseId', id)
      else next.delete('courseId')
      next.delete('tab')   // новый курс всегда открываем на «Программе курса»
      return next
    })
  }, [setSearchParams])
  const [modules,     setModules]     = useState<Module[]>([])
  const [loadingMods, setLoadingMods] = useState(false)
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [loadKey,     setLoadKey]     = useState(0)
  const tabParam = searchParams.get('tab')
  const tab = ((COURSE_TABS as readonly string[]).includes(tabParam ?? '') ? tabParam : 'program') as CourseTab
  const setTab = useCallback((t: CourseTab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (t === 'program') next.delete('tab')
      else next.set('tab', t)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const [addingMod,   setAddingMod]   = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [editMode,      setEditMode]      = useState(false)
  const [groups,          setGroups]          = useState<{ id: string; name: string }[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [showCopyTemplate, setShowCopyTemplate] = useState(false)
  const [isReordering, setIsReordering] = useState(false)
  const [creatingModuleId, setCreatingModuleId] = useState<string | null>(null)
  const [creatingTopicId, setCreatingTopicId] = useState<string | null>(null)
  const [activeDragTopicId, setActiveDragTopicId] = useState<string | null>(null)
  const dragStartModulesRef = useRef<Module[] | null>(null)
  const { templates } = useCourseHomeworkTemplates(selectedId)

  // Имена владельцев для карточек курсов — одним запросом на весь список.
  // У кого профиль не читается (RLS не пускает преподавателя к чужим),
  // строка просто не показывается — имя здесь подсказка, а не право доступа.
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({})
  const ownerIdsKey = useMemo(
    () => Array.from(new Set(courses.map(c => c.owner_id).filter((x): x is string => !!x))).sort().join(','),
    [courses],
  )

  useEffect(() => {
    const ids = ownerIdsKey ? ownerIdsKey.split(',') : []
    if (ids.length === 0) {
      setOwnerNames({})
      return
    }
    let cancelled = false
    supabase.from('profiles').select('id, full_name').in('id', ids).then(({ data }) => {
      if (cancelled) return
      setOwnerNames(Object.fromEntries((data ?? []).map(p => [p.id, p.full_name ?? ''])))
    })
    return () => { cancelled = true }
  }, [ownerIdsKey])

  const ownerLabelFor = (course: Course): string | null => {
    if (!course.owner_id) return null
    if (course.owner_id === profile?.id) return 'Ваш курс'
    return ownerNames[course.owner_id] || null
  }

  // Чей это курс. Нужно только чтобы показать админу «это курс такого-то» и
  // дать кнопку «Посмотреть его глазами» — сам доступ решает RLS, не эта плашка.
  const [courseOwner, setCourseOwner] = useState<{ id: string; name: string } | null>(null)
  const [impersonating, setImpersonating] = useState(false)
  const selectedOwnerId = (courses.find(c => c.id === searchParams.get('courseId')) ?? null)?.owner_id ?? null

  useEffect(() => {
    if (!selectedOwnerId || selectedOwnerId === profile?.id) {
      setCourseOwner(null)
      return
    }
    let cancelled = false
    supabase.from('profiles').select('id, full_name').eq('id', selectedOwnerId).single()
      .then(({ data }) => {
        if (!cancelled) setCourseOwner(data ? { id: data.id, name: data.full_name ?? 'Без имени' } : null)
      })
    return () => { cancelled = true }
  }, [selectedOwnerId, profile?.id])

  // Копирование: курса целиком и отдельной темы в другой курс.
  const [copyCourseOpen, setCopyCourseOpen] = useState(false)
  const [copyTopicSource, setCopyTopicSource] = useState<Topic | null>(null)
  const [deleteCourseOpen, setDeleteCourseOpen] = useState(false)

  // Topic materials modal
  const [matTopic,  setMatTopic]  = useState<{ topic: Topic; moduleTitle: string } | null>(null)
  // Растёт при закрытии модалки: вкладки курса перечитывают данные без F5.
  const [matRefreshKey, setMatRefreshKey] = useState(0)
  const [toastMsg,  setToastMsg]  = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openMaterials(topic: Topic, moduleTitle: string) {
    setMatTopic({ topic, moduleTitle })
  }

  // ВАЖНО: без useMemo этот объект создаётся заново на каждый рендер.
  // Он стоит в зависимостях эффектов и уходит в пропсы дочерних компонентов,
  // поэтому «новый объект каждый раз» превращался в бесконечный цикл
  // перерисовки: эффект -> setState -> рендер -> новый объект -> эффект.
  // React обрывал такой цикл ошибкой «Maximum update depth exceeded» и
  // ВЫБРАСЫВАЛ вместе с ним отложенное обновление — в том числе переход на
  // другую страницу. Снаружи это выглядело так: адрес в браузере сменился,
  // а страница осталась прежней, и помогала только перезагрузка.
  const homeworkByTopic = useMemo(
    () => templates.reduce<Record<string, TopicHomeworkV2Summary>>((acc, template) => {
      if (!template.topic_id) return acc
      const current = acc[template.topic_id] ?? { templateCount: 0, assignmentCount: 0, lastAssignedAt: null }
      current.templateCount += 1
      current.assignmentCount += template.assignments_count
      if (!current.lastAssignedAt || (template.last_assigned_at && template.last_assigned_at > current.lastAssignedAt)) {
        current.lastAssignedAt = template.last_assigned_at
      }
      acc[template.topic_id] = current
      return acc
    }, {}),
    [templates],
  )

  /**
   * Состояние ДЗ по темам курса — ОДНИМ запросом (§117).
   *
   * В строке темы видно, есть ли задание и до какого числа. Запрос на строку
   * здесь означал бы 169 запросов на открытие курса, поэтому берём разом все
   * темы и раскладываем по id. Источник тот же, что у модалки, — таблица
   * `topic_homework`; второй механизм не заводим.
   */
  const [homeworkStateByTopic, setHomeworkStateByTopic] = useState<Record<string, TopicHomeworkRow[]>>({})

  useEffect(() => {
    const topicIds = modules.flatMap(m => m.topics.map(t => t.id))
    if (topicIds.length === 0) {
      setHomeworkStateByTopic({})
      return
    }
    let cancelled = false

    supabase
      .from('topic_homework')
      .select('topic_id, is_published, due_at')
      .in('topic_id', topicIds)
      .then(({ data }) => {
        if (cancelled) return
        setHomeworkStateByTopic(groupHomeworkByTopic((data ?? []) as unknown as TopicHomeworkRow[]))
      })

    return () => { cancelled = true }
  }, [modules, matRefreshKey])

  // Производная величина, а не состояние: считаем на месте. Раньше её клали
  // в useState через useEffect — это и был источник цикла выше.
  const homeworkCountsByTopic = useMemo<Record<string, number>>(
    () => Object.fromEntries(
      Object.entries(homeworkByTopic).map(([topicId, summary]) => [topicId, summary.templateCount + summary.assignmentCount]),
    ),
    [homeworkByTopic],
  )

  // Рабочие курсы наверх, архивные — под спойлер. Раньше три технических
  // «[E2E] Цикл ДЗ …» с пометкой «архив» стояли первыми и оттесняли живые
  // курсы за пределы первого экрана.
  /**
   * Раскладка списка живёт в `lib/courseGrouping` — там же её тесты (§113).
   *
   * Архив тут НЕ равен «неактивен»: свежая копия рождается неактивным
   * черновиком, и по одному `is_active` обе копии уехали бы в архив, оставив
   * шаблоны с пустыми полками.
   */
  const grouped = useMemo(() => groupCoursesByTemplate(courses), [courses])

  const selectedCourse = courses.find(c => c.id === selectedId) || null


  // Load modules + groups when course selected
  useEffect(() => {
    if (!selectedId) return
    setLoadingMods(true)
    setLoadError(null)
    setEditMode(false)

    async function loadAll() {
      try {
        const [mods, gsRes] = await Promise.all([
          loadModules(selectedId!),
          supabase.from('groups').select('id, name').eq('course_id', selectedId!).order('name'),
        ])
        const grps = (gsRes.data || []) as { id: string; name: string }[]
        setModules(mods)
        setGroups(grps)
        setSelectedGroupId(grps[0]?.id ?? null)
      } catch (e: any) {
        setLoadError(e.message || 'Не удалось загрузить программу курса')
        setModules([])
      }
    }

    loadAll().finally(() => setLoadingMods(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadKey])

  // Clean up toast timer on unmount
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  async function refreshModules() {
    if (!selectedId) return
    try {
      const mods = await loadModules(selectedId)
      setModules(mods)
    } catch (e: any) {
      setLoadError(e.message || 'Не удалось обновить программу курса')
    }
  }

  async function handleAddModule() {
    if (!selectedId) return
    setAddingMod(true)
    try {
      const moduleId = await createModule(selectedId, 'Новый модуль')
      await refreshModules()
      setCreatingModuleId(moduleId)
      setEditMode(true)
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code ?? '') : ''
      if (code === '42501' || code.startsWith('PGRST')) {
        toast.error('Недостаточно прав для создания модуля')
      } else {
        toast.error(e instanceof Error ? e.message : 'Не удалось создать модуль')
      }
    } finally {
      setAddingMod(false)
    }
  }

  async function handleCreateFirstModuleForTemplateCopy() {
    if (!selectedId) throw new Error('Курс не выбран')
    const moduleId = await createModule(selectedId, 'Модуль 1')
    await refreshModules()
    return moduleId
  }

  async function handleSaveModule(id: string, title: string) {
    await saveModule(id, title)
    if (creatingModuleId === id) setCreatingModuleId(null)
    await refreshModules()
  }

  async function handleDeleteModule(id: string) {
    await deleteModule(id)
    if (creatingModuleId === id) setCreatingModuleId(null)
    setModules(prev => prev.filter(m => m.id !== id))
  }

  async function handleSaveTopic(id: string, values: Partial<Topic>) {
    await saveTopic(id, values)
    if (creatingTopicId === id && values.title?.trim()) setCreatingTopicId(null)
    setModules(prev => prev.map(m => ({
      ...m,
      topics: m.topics.map(t => t.id === id ? { ...t, ...values } : t),
    })))
  }

  /**
   * Переключение тумблера открытости из строки списка. Пишет is_open явно,
   * а не «переворачивает» вычисленное: тема на автоматике по дате своего
   * true/false не имеет, и без явной записи первое нажатие ничего бы не дало.
   */
  async function handleToggleTopicOpen(id: string, isOpen: boolean) {
    await handleSaveTopic(id, { is_open: isOpen })
  }

  async function handleDeleteTopic(id: string) {
    const visibleHomeworkCount = homeworkCountsByTopic[id] ?? 0
    if (visibleHomeworkCount > 0) {
      toast.error(formatHomeworkCountMessage(visibleHomeworkCount))
      return
    }

    try {
      const deletedCount = await deleteTopic(id)
      if (deletedCount === 0) {
        toast.error('Недостаточно прав для удаления темы')
        return
      }
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code ?? '') : ''
      if (code === '23503') {
        toast.error('В теме есть домашние задания, удаление невозможно')
      } else if (code === '42501' || code.startsWith('PGRST')) {
        toast.error('Недостаточно прав')
      } else {
        console.error('Failed to delete topic', e)
        toast.error('Не удалось удалить тему')
      }
      return
    }
    setModules(prev => prev.map(m => ({
      ...m,
      topics: m.topics.filter(t => t.id !== id),
    })))
    if (creatingTopicId === id) setCreatingTopicId(null)
  }

  async function handleAddTopic(moduleId: string) {
    try {
      const topicId = await createTopic(moduleId, 'Новая тема')
      await refreshModules()
      setCreatingTopicId(topicId)
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code ?? '') : ''
      if (code === '42501' || code.startsWith('PGRST')) {
        toast.error('Недостаточно прав для создания темы')
      } else {
        toast.error(e instanceof Error ? e.message : 'Не удалось создать тему')
      }
    }
  }

  async function handleCancelCreateModule(id: string) {
    await deleteModule(id)
    setCreatingModuleId(null)
    setModules(prev => prev.filter(m => m.id !== id))
  }

  async function handleCancelCreateTopic(id: string) {
    await deleteTopic(id)
    setCreatingTopicId(null)
  }

  function handleTopicDragStart(event: DragStartEvent) {
    setActiveDragTopicId(String(event.active.id))
    dragStartModulesRef.current = modules
  }

  function handleTopicDragOver(event: DragOverEvent) {
    if (!activeDragTopicId || !event.over) return

    const activeTopicId = String(event.active.id)
    const overId = String(event.over.id)
    if (activeTopicId === overId) return

    setModules(prev => {
      const sourcePos = findTopicPosition(prev, activeTopicId)
      const targetModule = findModuleByOverId(prev, overId)
      if (!sourcePos || !targetModule) return prev

      const sourceModuleId = prev[sourcePos.moduleIndex].id
      if (sourceModuleId === targetModule.id) return prev

      const next = moveTopicBetweenModules(prev, activeTopicId, overId, {
        placeAfter: shouldPlaceAfter(overId, event),
      })
      return sameLayout(prev, next) ? prev : next
    })
  }

  async function handleTopicDragEnd(event: DragEndEvent) {
    const startModules = dragStartModulesRef.current ?? modules
    dragStartModulesRef.current = null
    setActiveDragTopicId(null)

    if (!selectedId || isReordering) return
    const { active, over } = event
    if (!over) {
      setModules(startModules)
      return
    }

    const activeTopicId = String(active.id)
    const overId = String(over.id)
    if (activeTopicId === overId) {
      setModules(startModules)
      return
    }

    const nextModules = moveTopicBetweenModules(modules, activeTopicId, overId, {
      placeAfter: shouldPlaceAfter(overId, event),
    })

    if (sameLayout(modules, nextModules)) {
      if (!sameLayout(startModules, modules)) setModules(startModules)
      return
    }

    if (sameLayout(startModules, nextModules)) {
      setModules(nextModules)
      return
    }

    setModules(nextModules)
    setIsReordering(true)

    try {
      const layout = buildTopicLayout(nextModules)
      const { error } = await (supabase as any).rpc('reorder_course_topics', {
        p_course_id: selectedId,
        p_layout: layout,
      })
      if (error) throw new Error(error.message)
      toast.success('Порядок тем обновлён')
      await refreshModules()
    } catch (e) {
      setModules(startModules)
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить порядок тем')
    } finally {
      setIsReordering(false)
    }
  }

  // ── New course form state
  const [newCourse, setNewCourse] = useState({
    title: '', subject: 'physics', exam_type: 'ege', description: '', price: 0, duration_weeks: 36, is_active: true,
  })
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [createError, setCreateError] = useState('')

  async function handleCreateCourse() {
    if (!newCourse.title.trim()) { setCreateError('Введите название'); return }
    setCreatingCourse(true)
    setCreateError('')
    try {
      const id = await createCourse(newCourse as Omit<Course, 'id'>)
      setShowNew(false)
      selectCourse(id)
      setNewCourse({ title: '', subject: 'physics', exam_type: 'ege', description: '', price: 0, duration_weeks: 36, is_active: true })
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreatingCourse(false)
    }
  }

  return (
    <>
    <div className="min-w-0">

      {!selectedCourse ? (
        <div className="space-y-4">
          {/* Карточка курса — <Link>, а не <button>: обычный клик проваливает
              в курс на весь экран, Ctrl+клик и клик колёсиком открывают его в
              новой вкладке браузера, а адрес курса можно скопировать и
              переслать. С <button> ничего из этого не работает. */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Курсы</h2>
          {isAdmin && (
            <button
              onClick={() => setShowNew(v => !v)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 hover:text-primary-800"
            >
              <Plus size={18} />
              Новый курс
            </button>
          )}
        </div>

      {/* New course form */}
      {showNew && (
        <div className="bg-white border border-primary-200 rounded-xl p-4 space-y-3 shadow-sm">
          <p className="text-xs font-semibold text-primary-700">Новый курс</p>
          <input
            placeholder="Название *"
            value={newCourse.title}
            onChange={e => setNewCourse(f => ({ ...f, title: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newCourse.subject}
              onChange={e => setNewCourse(f => ({ ...f, subject: e.target.value }))}
              className="min-h-11 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            >
              <option value="physics">Физика</option>
              <option value="math">Математика</option>
            </select>
            <select
              value={newCourse.exam_type}
              onChange={e => setNewCourse(f => ({ ...f, exam_type: e.target.value }))}
              className="min-h-11 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            >
              <option value="ege">ЕГЭ</option>
              <option value="oge">ОГЭ</option>
            </select>
          </div>
          {createError && <p className="text-xs text-red-500">{createError}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleCreateCourse} loading={creatingCourse}>
              Создать
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowNew(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 size={16} className="animate-spin" />Загрузка…
          </div>
        ) : courses.length === 0 ? (
          <p className="py-4 text-sm text-gray-400">Нет курсов</p>
        ) : (
          <>
            {/* Шаблоны — сеткой в ряд, ответвления вниз (§114).
                Раньше каждый шаблон занимал свою строку вместе с полкой копий,
                и три шаблона растягивались на три экрана. Теперь шаблон —
                обычная плитка в общей сетке, а копии висят ветвью под своей
                плиткой, в её же колонке: с короткими именами («11А») они
                занимают строку, а не карточку, и ряд шаблонов не рвётся. */}
            {grouped.groups.length > 0 && (
              <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.groups.map(group => (
                  <div key={group.template.id} className="space-y-2">
                    <CourseCard course={group.template} ownerLabel={ownerLabelFor(group.template)} />
                    {group.copies.length > 0 && (
                      <CourseCopiesShelf template={group.template} copies={group.copies} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Всё, что живёт само по себе: обычные курсы и копии, потерявшие
                шаблон. Потерять курс из списка страшнее, чем показать его без
                родителя. */}
            {grouped.loose.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {grouped.loose.map(c => <CourseCard key={c.id} course={c} ownerLabel={ownerLabelFor(c)} />)}
              </div>
            )}

            {/* Архивные курсы уводим под спойлер: их не открывают каждый день,
                а в общем списке они оттесняли рабочие курсы вниз. */}
            {grouped.archived.length > 0 && (
              <details className="rounded-2xl border border-gray-100 bg-white/60 px-4 py-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-gray-500 hover:text-gray-700">
                  Архив · {grouped.archived.length}
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {grouped.archived.map(c => <CourseCard key={c.id} course={c} ownerLabel={ownerLabelFor(c)} />)}
                </div>
              </details>
            )}
          </>
        )}
      </div>
      ) : (
        <div className="space-y-5">
          {/* Возврат к списку — тоже ссылка: работает «назад» браузера,
              средняя кнопка мыши и копирование адреса. */}
          <Link
            to="/course-program"
            className="inline-flex min-h-11 items-center gap-1.5 -ml-1 rounded-xl px-2 text-sm text-gray-500 transition-colors hover:text-primary-700"
          >
            <ChevronLeft size={16} />
            Все курсы
          </Link>
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-gray-900 break-words">{selectedCourse.title}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <Badge variant="info">{SUBJECT_LABELS[selectedCourse.subject] || selectedCourse.subject}</Badge>
                  <Badge variant="default">{EXAM_LABELS[selectedCourse.exam_type] || selectedCourse.exam_type}</Badge>
                  <Badge variant={selectedCourse.is_active ? 'success' : 'default'}>
                    {selectedCourse.is_active ? 'Активен' : 'Архив'}
                  </Badge>
                  <CourseDateBadge course={selectedCourse} />
                  <span className="text-xs text-gray-400">{selectedCourse.duration_weeks} нед.</span>
                </div>
              </div>
            </div>

            {/* Чужой курс: админ должен видеть, в чьём хозяйстве он находится,
                ДО того как начнёт править. Кнопка рядом — вход под владельцем
                (та же механика, что «Быстрый вход» у демо; сервер не пустит
                под другого админа). */}
            {courseOwner && (
              <div
                data-testid="course-owner-banner"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5"
              >
                <GraduationCap size={16} className="shrink-0 text-violet-600" />
                <span className="text-sm text-violet-900">
                  Это курс преподавателя <strong>{courseOwner.name}</strong> — вы здесь как администратор
                </span>
                {isPlatformAdmin && (
                  <button
                    type="button"
                    disabled={impersonating}
                    onClick={async () => {
                      setImpersonating(true)
                      try {
                        await impersonate(courseOwner.id, courseOwner.name)
                        window.location.href = '/dashboard'
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Не удалось войти')
                        setImpersonating(false)
                      }
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
                  >
                    {impersonating ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                    Посмотреть его глазами
                  </button>
                )}
              </div>
            )}

            {/* Вкладки курса. role=tablist/tab — не украшение: с ними
                скринридер объявляет «вкладка 3 из 6», а стрелки влево-вправо
                воспринимаются как переключение, а не как обход кнопок. */}
            <div role="tablist" aria-label="Разделы курса" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
              {[
                { key: 'program',   label: 'Программа курса' },
                { key: 'materials', label: 'Материалы' },
                { key: 'homework',  label: 'Домашние задания' },
                { key: 'testresults', label: 'Результаты тестов' },
                { key: 'students',  label: 'Ученики' },
                ...(canEdit ? [{ key: 'settings', label: 'Настройки' }] : []),
              ].map(t => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key as CourseTab)}
                  className={cn(
                    'min-h-11 shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    tab === t.key
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Program tab */}
            {tab === 'program' && (
              <div className="space-y-4">

                {/* ── Edit toggle ── */}
                {canEdit && !loadingMods && modules.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setShowCopyTemplate(true)}>
                      <Plus size={15} className="mr-1.5" />
                      Добавить из библиотеки
                    </Button>
                    <button
                      onClick={() => setEditMode(e => !e)}
                      className={cn(
                        'flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        editMode
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      )}
                    >
                      <Pencil size={12} />
                      {editMode ? 'Завершить редактирование' : 'Редактировать программу'}
                    </button>
                  </div>
                )}

                {loadingMods ? (
                  <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
                    <Loader2 size={18} className="animate-spin" />Загрузка программы…
                  </div>
                ) : loadError ? (
                  <div className="text-center py-12">
                    <p className="text-red-500 text-sm mb-3">{loadError}</p>
                    <button
                      onClick={() => setLoadKey(k => k + 1)}
                      className="text-sm text-primary-600 underline hover:no-underline"
                    >
                      Повторить
                    </button>
                  </div>
                ) : modules.length === 0 ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
                    <BookOpen size={32} className="mx-auto mb-3 opacity-30 text-gray-400" />
                    <p className="text-sm font-medium text-gray-700">В курсе пока нет модулей</p>
                    {canEdit ? (
                      <>
                        <p className="mt-1 text-sm text-gray-400">Добавьте первый модуль, чтобы начать собирать программу курса.</p>
                        <Button className="mt-4" onClick={handleAddModule} loading={addingMod}>
                          <Plus size={15} className="mr-1.5" />
                          Добавить модуль
                        </Button>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-gray-400">Обратитесь к владельцу курса или администратору, чтобы заполнить программу.</p>
                    )}
                  </div>
                ) : editMode ? (
                  <>
                    <div className="hidden sm:flex items-center gap-3 px-3 text-xs text-gray-400 font-medium uppercase tracking-wide">
                      <div className="flex-1">Тема</div>
                      <div className="w-20 text-center">Баллы</div>
                      <div className="w-10" />
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCorners}
                      onDragStart={handleTopicDragStart}
                      onDragOver={handleTopicDragOver}
                      onDragEnd={handleTopicDragEnd}
                    >
                      <div className="space-y-3">
                        {modules.map((mod, moduleIndex) => (
                          <ModuleCard
                            key={mod.id}
                            module={mod}
                            moduleNumber={getModuleDisplayNumber(moduleIndex)}
                            canEdit={canEdit}
                            editMode={editMode}
                            homeworkCountsByTopic={homeworkCountsByTopic}
                            homeworkStateByTopic={homeworkStateByTopic}
                            creatingTopicId={creatingTopicId}
                            onCancelCreateTopic={handleCancelCreateTopic}
                            startEditingModule={creatingModuleId === mod.id}
                            onCancelCreateModule={handleCancelCreateModule}
                            onSaveModule={handleSaveModule}
                            onDeleteModule={handleDeleteModule}
                            onSaveTopic={handleSaveTopic}
                            onDeleteTopic={handleDeleteTopic}
                            onAddTopic={handleAddTopic}
                            onOpenMaterials={openMaterials}
                            onCopyTopic={setCopyTopicSource}
                            isReordering={isReordering}
                          />
                        ))}
                      </div>
                      <DragOverlay>
                        {activeDragTopicId ? (() => {
                          const activePos = findTopicPosition(modules, activeDragTopicId)
                          if (!activePos) return null
                          const activeModule = modules[activePos.moduleIndex]
                          const activeTopic = activeModule.topics[activePos.topicIndex]
                          return (
                            <TopicDragOverlay
                              topic={activeTopic}
                              topicNumber={getTopicDisplayNumber(activePos.moduleIndex, activePos.topicIndex)}
                            />
                          )
                        })() : null}
                      </DragOverlay>
                    </DndContext>
                    <Button variant="secondary" size="sm" onClick={handleAddModule} loading={addingMod}>
                      <Plus size={15} className="mr-1.5" />Добавить модуль
                    </Button>
                  </>
                ) : (
                  <HwTable
                    modules={modules}
                    homeworkByTopic={homeworkByTopic}
                    homeworkStateByTopic={homeworkStateByTopic}
                    onOpenTopic={openMaterials}
                    onOpenHomeworkTab={() => setTab('homework')}
                    onToggleTopicOpen={handleToggleTopicOpen}
                  />
                )}
              </div>
            )}

            {/* Materials tab */}
            {tab === 'materials' && (
              <MaterialsMatrix
                courseId={selectedCourse.id}
                modules={modules}
                onOpenTopic={(topic, moduleTitle) => setMatTopic({ topic, moduleTitle })}
                onGoToProgram={() => setTab('program')}
                onToggleTopicOpen={handleToggleTopicOpen}
                refreshKey={matRefreshKey}
              />
            )}

            {/* Homework tab */}
            {tab === 'homework' && (
              <CourseTopicHomeworkSection courseId={selectedCourse.id} modules={modules} refreshKey={matRefreshKey} onToggleTopicOpen={handleToggleTopicOpen} />
            )}

            {/* Test Results tab */}
            {tab === 'testresults' && (
              <CourseTestResultsSection courseId={selectedCourse.id} modules={modules} refreshKey={matRefreshKey} />
            )}

            {/* Students tab */}
            {tab === 'students' && (
              <CourseStudentsSection courseId={selectedCourse.id} />
            )}

            {/* Settings tab */}
            {tab === 'settings' && canEdit && (
              <CourseSettings
                course={selectedCourse}
                onSave={v => saveCourse(selectedCourse.id, v)}
                onCopyCourse={() => setCopyCourseOpen(true)}
                onDeleteCourse={() => setDeleteCourseOpen(true)}
              />
            )}
        </div>
      )}
    </div>

    <TopicMaterialsModal
      open={!!matTopic}
      onClose={() => { setMatTopic(null); setMatRefreshKey(k => k + 1) }}
      topicId={matTopic?.topic.id ?? null}
      topicTitle={matTopic?.topic.title ?? ''}
      moduleTitle={matTopic?.moduleTitle ?? ''}
      availableFrom={matTopic?.topic.available_from ?? null}
      isOpen={matTopic?.topic.is_open ?? null}
      onSaveTopicMeta={async values => {
        if (!matTopic?.topic.id) return
        await handleSaveTopic(matTopic.topic.id, values)
        setMatTopic(prev => prev ? { ...prev, topic: { ...prev.topic, ...values } } : prev)
      }}
      onOpenUntilHere={async () => {
        if (!matTopic?.topic.id) return 0
        const { data, error } = await supabase.rpc('topics_open_until', { p_topic_id: matTopic.topic.id })
        if (error) throw new Error(error.message)
        // Список перечитываем целиком: открылась не только эта тема.
        reloadCourses()
        return data ?? 0
      }}
    />

    {selectedCourse && (
      <DeleteCourseDialog
        open={deleteCourseOpen}
        onClose={() => setDeleteCourseOpen(false)}
        courseId={selectedCourse.id}
        courseTitle={selectedCourse.title}
        onDeleted={() => {
          setDeleteCourseOpen(false)
          // Курса больше нет: уводим с его страницы, иначе останемся на
          // адресе с несуществующим courseId и получим пустой экран.
          selectCourse(null)
          void reloadCourses()
        }}
      />
    )}

    {selectedCourse && (
      <CopyCourseDialog
        open={copyCourseOpen}
        onClose={() => { setCopyCourseOpen(false); void reloadCourses() }}
        course={selectedCourse}
        onCopied={newCourseId => {
          setCopyCourseOpen(false)
          void reloadCourses()
          selectCourse(newCourseId)
        }}
      />
    )}

    <CopyTopicDialog
      open={!!copyTopicSource}
      onClose={() => setCopyTopicSource(null)}
      topic={copyTopicSource}
      sourceCourseId={selectedId}
      courses={courses}
      loadModules={loadModules}
      onCopied={(targetCourseId, _targetModuleId) => {
        setCopyTopicSource(null)
        // Копия в текущем курсе не меняет адрес — перечитываем модули вручную,
        // иначе новая тема появится только после F5.
        if (targetCourseId === selectedId) void refreshModules()
        else selectCourse(targetCourseId)
      }}
    />

    <AddLessonTemplateToCourseModal
      open={showCopyTemplate}
      courseId={selectedCourse?.id ?? ''}
      groupId={selectedGroupId}
      groupName={groups.find(group => group.id === selectedGroupId)?.name ?? null}
      modules={modules}
      defaultModuleId={modules[0]?.id ?? null}
      onCreateModule={handleCreateFirstModuleForTemplateCopy}
      onClose={() => setShowCopyTemplate(false)}
      onCopied={() => {
        setShowCopyTemplate(false)
        refreshModules()
      }}
    />

    {toastMsg && (
      <div className="fixed bottom-4 left-4 right-4 sm:bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl shadow-lg pointer-events-none">
        <Check size={16} className="text-green-400 shrink-0" />
        {toastMsg}
      </div>
    )}
    </>
  )
}

// ── helpers used by CourseSettings ──────────────────────────────────────────
function QuickDateBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
    >
      {label}
    </button>
  )
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function CourseDateBadge({ course }: { course: Course }) {
  if (!course.start_date && !course.end_date) return null
  const today = new Date().toISOString().slice(0, 10)
  let kind: 'active' | 'upcoming' | 'ended' = 'active'
  if (course.start_date && today < course.start_date) kind = 'upcoming'
  else if (course.end_date && today > course.end_date) kind = 'ended'

  const cls = kind === 'active'   ? 'bg-green-100 text-green-700'
            : kind === 'upcoming' ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-500'
  const label = kind === 'active' ? 'Идёт' : kind === 'upcoming' ? 'Скоро' : 'Завершён'

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', cls)}>
      <Calendar size={11} />{label}
      {course.start_date && course.end_date && (
        <span className="font-normal opacity-80 ml-1">
          {formatDateShort(course.start_date)} → {formatDateShort(course.end_date)}
        </span>
      )}
    </span>
  )
}
