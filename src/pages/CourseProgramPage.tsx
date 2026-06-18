import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, Plus, ChevronDown, ChevronRight, Pencil, Trash2,
  Check, X, Calendar, GraduationCap, Save, Loader2, ToggleLeft, ToggleRight, FileText,
  Video, Lightbulb, BookMarked, ClipboardList, RotateCcw, Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useCourseProgram, type Course, type Module, type Topic } from '@/hooks/useCourseProgram'
import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'

// ─── Inline editable text ────────────────────────────────────────────────────
function InlineEdit({
  value, onSave, className = '', placeholder = 'Введите название',
}: { value: string; onSave: (v: string) => Promise<void>; className?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText]       = useState(value)
  const [saving, setSaving]   = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  async function commit() {
    if (!text.trim() || text === value) { setEditing(false); return }
    setSaving(true)
    try { await onSave(text.trim()); setEditing(false) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className={cn('border border-primary-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400', className)}
        />
        <button onClick={commit} disabled={saving} className="text-green-500 hover:text-green-700">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-red-500">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <span
      className={cn('cursor-pointer hover:text-primary-600 transition-colors group', className)}
      onClick={() => { setText(value); setEditing(true) }}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
      <Pencil size={11} className="inline ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity" />
    </span>
  )
}

// ─── Topic row ───────────────────────────────────────────────────────────────
interface HwStat { submitted: number; pending: number; revision: number; total: number }


// ─── HW table (view mode) ────────────────────────────────────────────────────
function HwTable({
  modules, hwStats, hwByTopic, groupId,
}: {
  modules: Module[]
  hwStats: Record<string, HwStat>
  hwByTopic: Record<string, { id: string; title: string; max_score: number }>
  groupId: string | null
}) {
  const navigate = useNavigate()

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Тема</th>
            <th className="px-3 py-3 text-center w-24">
              <div className="flex flex-col items-center gap-0.5 text-green-500">
                <Check size={12} className="text-green-600" />
                <span className="text-[10px] font-medium text-gray-500">Сдали</span>
              </div>
            </th>
            <th className="px-3 py-3 text-center w-24">
              <div className="flex flex-col items-center gap-0.5 text-orange-500">
                <ClipboardList size={12} className="text-orange-500" />
                <span className="text-[10px] font-medium text-gray-500">На проверке</span>
              </div>
            </th>
            <th className="px-3 py-3 text-center w-24">
              <div className="flex flex-col items-center gap-0.5 text-yellow-500">
                <RotateCcw size={12} className="text-yellow-600" />
                <span className="text-[10px] font-medium text-gray-500">На доработке</span>
              </div>
            </th>
            <th className="px-3 py-3 text-center w-24">
              <div className="flex flex-col items-center gap-0.5 text-red-400">
                <X size={12} className="text-red-500" />
                <span className="text-[10px] font-medium text-gray-500">Не сдали</span>
              </div>
            </th>
            <th className="px-3 py-3 text-center w-28">
              <div className="flex flex-col items-center gap-0.5 text-blue-400">
                <GraduationCap size={12} />
                <span className="text-[10px] font-medium text-gray-500">% сдачи</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {modules.map(mod => (
            <>
              <tr key={`mod-${mod.id}`} className="bg-primary-50/50">
                <td colSpan={6} className="px-4 py-2">
                  <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{mod.title}</span>
                  <span className="text-xs text-primary-400 ml-2">{mod.topics.length} тем</span>
                </td>
              </tr>

              {mod.topics.map((topic, ti) => {
                const s        = hwStats[topic.id]
                const revision = s ? s.revision : 0
                const checked  = s ? Math.max(0, s.submitted - s.pending - revision) : 0
                const notDone  = s ? Math.max(0, s.total - s.submitted) : 0
                const pct     = s && s.total > 0 ? Math.round(s.submitted / s.total * 100) : null
                const hw      = hwByTopic[topic.id]

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
                      {hw ? (
                        <button
                          onClick={() => navigate(`/homeworks/${hw.id}/review/${groupId}`)}
                          className="group flex items-center gap-1.5 text-left hover:text-primary-600 transition-colors"
                        >
                          <ChevronRight size={13} className="text-gray-300 group-hover:text-primary-400 shrink-0 transition-colors" />
                          <span className="text-sm text-gray-800 group-hover:text-primary-600 group-hover:underline underline-offset-2">
                            {topic.title}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <ChevronRight size={13} className="text-gray-200 shrink-0" />
                          <span className="text-sm text-gray-400">{topic.title}</span>
                        </div>
                      )}
                    </td>

                    {/* Сдали (проверенные) */}
                    <td className="px-3 py-3 text-center">
                      {checked > 0
                        ? <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 bg-green-100 rounded-full text-xs font-semibold text-green-700">{checked}</span>
                        : s
                          ? <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full mx-auto"><X size={11} className="text-gray-300" /></span>
                          : <span className="text-xs text-gray-200">—</span>
                      }
                    </td>

                    {/* На проверке */}
                    <td className="px-3 py-3 text-center">
                      {s && s.pending > 0
                        ? <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 bg-orange-100 rounded-full text-xs font-semibold text-orange-600">{s.pending}</span>
                        : s
                          ? <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 rounded-full mx-auto"><Check size={11} className="text-green-500" /></span>
                          : <span className="text-xs text-gray-200">—</span>
                      }
                    </td>

                    {/* На доработке */}
                    <td className="px-3 py-3 text-center">
                      {revision > 0
                        ? <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 bg-yellow-100 rounded-full text-xs font-semibold text-yellow-700">{revision}</span>
                        : s
                          ? <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full mx-auto"><X size={11} className="text-gray-300" /></span>
                          : <span className="text-xs text-gray-200">—</span>
                      }
                    </td>

                    {/* Не сдали */}
                    <td className="px-3 py-3 text-center">
                      {notDone > 0
                        ? <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 bg-red-100 rounded-full text-xs font-semibold text-red-600">{notDone}</span>
                        : s
                          ? <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 rounded-full mx-auto"><Check size={11} className="text-green-500" /></span>
                          : <span className="text-xs text-gray-200">—</span>
                      }
                    </td>

                    {/* % сдачи */}
                    <td className="px-3 py-3">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', pct === 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-400' : 'bg-orange-400')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 shrink-0 w-8 text-right">{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-200">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Edit mode: topic row with inline editing controls
function TopicRowEdit({
  topic, onSave, onDelete, onOpenMaterials, moduleTitle,
}: {
  topic: Topic
  moduleTitle: string
  onSave: (id: string, v: Partial<Topic>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpenMaterials: (topic: Topic, moduleTitle: string) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [dateVal,  setDateVal]  = useState(topic.available_from || '')
  const [savingDate, setSavingDate] = useState(false)

  async function handleDateBlur() {
    if (dateVal === (topic.available_from || '')) return
    setSavingDate(true)
    try { await onSave(topic.id, { available_from: dateVal || null }) } finally { setSavingDate(false) }
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 group">
      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <InlineEdit value={topic.title} onSave={v => onSave(topic.id, { title: v })} className="w-full text-sm" />
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
        <span className="hidden sm:inline">Макс:</span>
        <input
          type="number"
          defaultValue={topic.max_score}
          min={1} max={100}
          onBlur={e => onSave(topic.id, { max_score: parseInt(e.target.value) || 100 })}
          className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
        <span>б.</span>
      </div>

      <div className="flex items-center gap-1 shrink-0 relative" title="Дата, с которой тема открывается ученикам. Пусто — доступна сразу">
        <Calendar size={12} className="text-gray-300" />
        <span className="text-xs text-gray-400 hidden sm:inline">Открыть с:</span>
        <input
          type="date"
          value={dateVal}
          onChange={e => setDateVal(e.target.value)}
          onBlur={handleDateBlur}
          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400 w-32"
        />
        {savingDate && <Loader2 size={10} className="absolute right-1 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
      </div>

      <button
        onClick={() => onOpenMaterials(topic, moduleTitle)}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-primary-500 transition-all shrink-0"
        title="Материалы темы"
      >
        <FileText size={14} />
      </button>

      <button
        onClick={async () => { setDeleting(true); try { await onDelete(topic.id) } finally { setDeleting(false) } }}
        disabled={deleting}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all shrink-0"
      >
        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  )
}

// ─── Module card ─────────────────────────────────────────────────────────────
function ModuleCard({
  module, canEdit, editMode, onSaveModule, onDeleteModule, onSaveTopic, onDeleteTopic, onAddTopic, onOpenMaterials, hwStats,
}: {
  module: Module
  canEdit: boolean
  editMode: boolean
  hwStats: Record<string, HwStat>
  onSaveModule: (id: string, title: string) => Promise<void>
  onDeleteModule: (id: string) => Promise<void>
  onSaveTopic: (id: string, v: Partial<Topic>) => Promise<void>
  onDeleteTopic: (id: string) => Promise<void>
  onAddTopic: (moduleId: string) => Promise<void>
  onOpenMaterials: (topic: Topic, moduleTitle: string) => void
}) {
  const [open,     setOpen]     = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [adding,   setAdding]   = useState(false)

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
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Module header */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100',
        canEdit && 'cursor-default'
      )}>
        <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-600 shrink-0">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="flex-1 font-semibold text-gray-800 text-sm">
          {canEdit ? (
            <InlineEdit
              value={module.title}
              onSave={v => onSaveModule(module.id, v)}
              className="font-semibold"
            />
          ) : (
            module.title
          )}
        </div>

        <Badge variant="default" className="text-xs">{module.topics.length} тем</Badge>

        {canEdit && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-gray-300 hover:text-red-500 transition-colors ml-1"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )}
      </div>

      {/* Topics */}
      {open && (
        <div className="divide-y divide-gray-50 bg-white">
          {module.topics.length === 0 && (
            <div className="text-sm text-gray-400 px-4 py-3 italic">Нет тем</div>
          )}
          {module.topics.map(t => (
            <TopicRowEdit
              key={t.id}
              topic={t}
              moduleTitle={module.title}
              onSave={onSaveTopic}
              onDelete={onDeleteTopic}
              onOpenMaterials={onOpenMaterials}
            />
          ))}

          {canEdit && (
            <div className="px-3 py-2">
              <button
                onClick={handleAddTopic}
                disabled={adding}
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
function CourseSettings({ course, onSave }: { course: Course; onSave: (v: Partial<Course>) => Promise<void> }) {
  const [form, setForm]   = useState({ ...course })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

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

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} loading={saving}>
          <Save size={15} className="mr-1.5" />Сохранить
        </Button>
        {saved && <span className="text-sm text-green-600 font-medium">Сохранено ✓</span>}
      </div>
    </div>
  )
}

// ─── Materials matrix ─────────────────────────────────────────────────────────
const MAT_COLS = [
  { type: 'notes',    label: 'Конспект',  icon: <BookMarked size={13} />,    color: 'text-blue-500' },
  { type: 'theory',   label: 'Теория',    icon: <BookOpen size={13} />,      color: 'text-purple-500' },
  { type: 'tasks',    label: 'Задачи',    icon: <ClipboardList size={13} />, color: 'text-orange-500' },
  { type: 'homework', label: 'ДЗ',        icon: <Lightbulb size={13} />,     color: 'text-yellow-500' },
  { type: 'solution', label: 'Решение',   icon: <Check size={13} />,         color: 'text-green-500' },
  { type: 'video',    label: 'Видео',     icon: <Video size={13} />,         color: 'text-red-500' },
]

function MaterialsMatrix({
  courseId, modules, onOpenTopic,
}: {
  courseId: string
  modules: Module[]
  onOpenTopic: (topic: Topic, moduleTitle: string) => void
}) {
  const [matMap, setMatMap] = useState<Record<string, Set<string>>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!courseId || !modules.length) return
    const topicIds = modules.flatMap(m => m.topics.map(t => t.id))
    if (!topicIds.length) { setLoading(false); return }

    supabase
      .from('topic_materials')
      .select('topic_id, type, file_url, link_url')
      .in('topic_id', topicIds)
      .then(({ data }) => {
        const map: Record<string, Set<string>> = {}
        for (const row of data || []) {
          // Only count if actually has file or link
          if (!row.file_url && !row.link_url) continue
          if (!map[row.topic_id]) map[row.topic_id] = new Set()
          map[row.topic_id].add(row.type)
        }
        setMatMap(map)
        setLoading(false)
      })
  }, [courseId, modules])

  const allTopics = modules.flatMap(m => m.topics.map(t => ({ topic: t, moduleTitle: m.title })))
  const totalCells = allTopics.length * MAT_COLS.length
  const filledCells = allTopics.reduce((s, { topic }) =>
    s + MAT_COLS.filter(c => matMap[topic.id]?.has(c.type)).length, 0)
  const fillPct = totalCells > 0 ? Math.round(filledCells / totalCells * 100) : 0

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
      <Loader2 size={18} className="animate-spin" />Загрузка…
    </div>
  )

  return (
    <div className="space-y-4">
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
              <>
                {/* Module header row */}
                <tr key={`mod-${mod.id}`} className="bg-primary-50/50">
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
                      <span className="text-sm text-gray-800 hover:text-primary-600 transition-colors">{topic.title}</span>
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
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function CourseProgramPage() {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const isAdmin = !!profile?.role && ['admin', 'owner'].includes(profile.role)

  const {
    courses, loading,
    loadModules, saveCourse, createCourse,
    saveModule, createModule, deleteModule,
    saveTopic, createTopic, deleteTopic,
  } = useCourseProgram()

  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [modules,     setModules]     = useState<Module[]>([])
  const [loadingMods, setLoadingMods] = useState(false)
  const [tab,         setTab]         = useState<'program' | 'materials' | 'settings'>('program')
  const [addingMod,   setAddingMod]   = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [hwStats,       setHwStats]       = useState<Record<string, HwStat>>({})
  const [hwByTopic,     setHwByTopic]     = useState<Record<string, { id: string; title: string; max_score: number }>>({})
  const [totalStudents, setTotalStudents] = useState(0)
  const [editMode,      setEditMode]      = useState(false)
  const [groups,          setGroups]          = useState<{ id: string; name: string }[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  // Topic materials modal
  const [matTopic, setMatTopic] = useState<{ topic: Topic; moduleTitle: string } | null>(null)

  function openMaterials(topic: Topic, moduleTitle: string) {
    setMatTopic({ topic, moduleTitle })
  }

  const selectedCourse = courses.find(c => c.id === selectedId) || null

  // Load modules + groups when course selected
  useEffect(() => {
    if (!selectedId) return
    setLoadingMods(true)
    setEditMode(false)

    async function loadAll() {
      const [mods, gsRes] = await Promise.all([
        loadModules(selectedId!),
        supabase.from('groups').select('id, name').eq('course_id', selectedId!).order('name'),
      ])
      const grps = (gsRes.data || []) as { id: string; name: string }[]
      setModules(mods)
      setGroups(grps)
      setSelectedGroupId(grps[0]?.id ?? null)   // по умолчанию — первая группа
    }

    loadAll().finally(() => setLoadingMods(false))
  }, [selectedId])

  // Recompute HW stats whenever the selected group (or modules) change
  useEffect(() => {
    loadHwStats(modules, selectedGroupId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId, modules])

  async function loadHwStats(mods: Module[], groupId: string | null) {
    const topicIds = mods.flatMap(m => m.topics.map(t => t.id))
    if (!topicIds.length || !groupId) {
      setHwStats({}); setHwByTopic({}); setTotalStudents(0)
      return
    }

    // Ученики выбранной группы
    const { data: gsRows } = await supabase
      .from('group_students').select('student_id').eq('group_id', groupId)
    const studentIds = (gsRows || []).map((r: any) => r.student_id)
    const groupSize = studentIds.length
    setTotalStudents(groupSize)

    // ДЗ курса (на уровне темы — общие для всех групп курса)
    const { data: hws } = await supabase
      .from('homeworks')
      .select('id, topic_id, title, max_score')
      .in('topic_id', topicIds)
    if (!hws?.length) { setHwStats({}); setHwByTopic({}); return }

    const hwIds = hws.map((h: any) => h.id)
    // Сдачи — только учеников этой группы
    const { data: subs } = studentIds.length
      ? await supabase
          .from('homework_submissions').select('homework_id, status')
          .in('homework_id', hwIds).in('student_id', studentIds)
      : { data: [] as any[] }

    const hwTopic: Record<string, string> = {}
    const stats: Record<string, HwStat> = {}
    for (const h of hws as any[]) {
      hwTopic[h.id] = h.topic_id
      if (!stats[h.topic_id]) stats[h.topic_id] = { submitted: 0, pending: 0, revision: 0, total: groupSize || 0 }
    }

    for (const s of (subs || []) as any[]) {
      const tid = hwTopic[s.homework_id]
      if (!tid) continue
      stats[tid].submitted++
      if (s.status === 'submitted') stats[tid].pending++
      if (s.status === 'revision')  stats[tid].revision++
    }

    setHwStats(stats)

    const byTopic: Record<string, { id: string; title: string; max_score: number }> = {}
    for (const h of hws as any[]) {
      byTopic[h.topic_id] = { id: h.id, title: h.title, max_score: h.max_score }
    }
    setHwByTopic(byTopic)
  }

  async function refreshModules() {
    if (!selectedId) return
    const mods = await loadModules(selectedId)
    setModules(mods)
    await loadHwStats(mods, selectedGroupId)
  }

  async function handleAddModule() {
    if (!selectedId) return
    setAddingMod(true)
    try {
      const id = await createModule(selectedId, 'Новый модуль', modules.length)
      await refreshModules()
    } finally {
      setAddingMod(false)
    }
  }

  async function handleSaveModule(id: string, title: string) {
    await saveModule(id, title)
    await refreshModules()
  }

  async function handleDeleteModule(id: string) {
    await deleteModule(id)
    setModules(prev => prev.filter(m => m.id !== id))
  }

  async function handleSaveTopic(id: string, values: Partial<Topic>) {
    await saveTopic(id, values)
    setModules(prev => prev.map(m => ({
      ...m,
      topics: m.topics.map(t => t.id === id ? { ...t, ...values } : t),
    })))
  }

  async function handleDeleteTopic(id: string) {
    await deleteTopic(id)
    setModules(prev => prev.map(m => ({
      ...m,
      topics: m.topics.filter(t => t.id !== id),
    })))
  }

  async function handleAddTopic(moduleId: string) {
    const mod = modules.find(m => m.id === moduleId)
    await createTopic(moduleId, 'Новая тема', mod?.topics.length || 0)
    await refreshModules()
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
      setSelectedId(id)
      setNewCourse({ title: '', subject: 'physics', exam_type: 'ege', description: '', price: 0, duration_weeks: 36, is_active: true })
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreatingCourse(false)
    }
  }

  return (
    <>
    <div className="flex gap-6 h-full">

      {/* ── Left: Courses list ── */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Курсы</h2>
          {isAdmin && (
            <button
              onClick={() => setShowNew(v => !v)}
              className="text-primary-600 hover:text-primary-800 transition-colors"
              title="Новый курс"
            >
              <Plus size={18} />
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
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
              >
                <option value="physics">Физика</option>
                <option value="math">Математика</option>
              </select>
              <select
                value={newCourse.exam_type}
                onChange={e => setNewCourse(f => ({ ...f, exam_type: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
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

        {/* Courses list */}
        {loading ? (
          <div className="text-gray-400 text-sm flex items-center gap-2 py-4">
            <Loader2 size={16} className="animate-spin" />Загрузка…
          </div>
        ) : courses.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">Нет курсов</p>
        ) : (
          <div className="space-y-1.5">
            {courses.map(c => (
              <button
                key={c.id}
                onClick={() => { setSelectedId(c.id); setTab('program') }}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-all',
                  selectedId === c.id
                    ? 'border-primary-300 bg-primary-50 shadow-sm'
                    : 'border-gray-100 bg-white hover:border-gray-300 hover:shadow-sm'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn(
                    'text-sm font-medium leading-snug',
                    selectedId === c.id ? 'text-primary-700' : 'text-gray-800'
                  )}>
                    {c.title}
                  </span>
                  {!c.is_active && (
                    <span className="text-xs text-gray-400 shrink-0 mt-0.5">архив</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="info" className="text-xs">{SUBJECT_LABELS[c.subject] || c.subject}</Badge>
                  <Badge variant="default" className="text-xs">{EXAM_LABELS[c.exam_type] || c.exam_type}</Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: Course detail ── */}
      <div className="flex-1 min-w-0">
        {!selectedCourse ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
            <GraduationCap size={40} className="opacity-30" />
            <p>Выберите курс слева</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{selectedCourse.title}</h1>
                <div className="flex items-center gap-2 mt-1">
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

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200">
              {[
                { key: 'program',   label: 'Программа курса' },
                { key: 'materials', label: 'Материалы' },
                ...(canEdit ? [{ key: 'settings', label: 'Настройки' }] : []),
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  className={cn(
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
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

                {/* ── Group selector ── */}
                {!loadingMods && groups.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
                      <Users size={13} /> Группа:
                    </span>
                    {groups.map(g => (
                      <button
                        key={g.id}
                        onClick={() => setSelectedGroupId(g.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                          selectedGroupId === g.id
                            ? 'bg-primary-50 border-primary-300 text-primary-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        )}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* ── Course summary ── */}
                {!loadingMods && (() => {
                  const totalSubmitted = Object.values(hwStats).reduce((s, h) => s + h.submitted, 0)
                  const totalPending   = Object.values(hwStats).reduce((s, h) => s + h.pending, 0)
                  const totalRevision  = Object.values(hwStats).reduce((s, h) => s + h.revision, 0)
                  const totalExpected  = Object.values(hwStats).reduce((s, h) => s + h.total, 0)
                  const totalNotDone   = Math.max(0, totalExpected - totalSubmitted)
                  const totalTopics    = modules.reduce((s, m) => s + m.topics.length, 0)
                  const topicsWithHw   = Object.keys(hwStats).length

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <div className="text-xl font-bold text-blue-700">{totalStudents}</div>
                        <div className="text-xs text-blue-500 mt-0.5">учеников</div>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <div className="text-xl font-bold text-green-700">{totalSubmitted}</div>
                        <div className="text-xs text-green-500 mt-0.5">сдано работ</div>
                      </div>
                      <div className={cn('rounded-xl p-3 text-center', totalNotDone > 0 ? 'bg-red-50' : 'bg-gray-50')}>
                        <div className={cn('text-xl font-bold', totalNotDone > 0 ? 'text-red-600' : 'text-gray-400')}>{totalNotDone}</div>
                        <div className={cn('text-xs mt-0.5', totalNotDone > 0 ? 'text-red-400' : 'text-gray-400')}>не сдали</div>
                      </div>
                      <div className={cn('rounded-xl p-3 text-center', totalPending > 0 ? 'bg-orange-50' : 'bg-gray-50')}>
                        <div className={cn('text-xl font-bold', totalPending > 0 ? 'text-orange-600' : 'text-gray-400')}>{totalPending}</div>
                        <div className={cn('text-xs mt-0.5', totalPending > 0 ? 'text-orange-400' : 'text-gray-400')}>на проверке</div>
                      </div>
                      <div className={cn('rounded-xl p-3 text-center', totalRevision > 0 ? 'bg-yellow-50' : 'bg-gray-50')}>
                        <div className={cn('text-xl font-bold', totalRevision > 0 ? 'text-yellow-700' : 'text-gray-400')}>{totalRevision}</div>
                        <div className={cn('text-xs mt-0.5', totalRevision > 0 ? 'text-yellow-600' : 'text-gray-400')}>на доработке</div>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Edit toggle ── */}
                {canEdit && !loadingMods && modules.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setEditMode(e => !e)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
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
                ) : modules.length === 0 ? (
                  <div className="text-center text-gray-400 py-12">
                    <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
                    <p>Программа пока пуста</p>
                    {canEdit && <p className="text-xs mt-1">Добавьте первый модуль</p>}
                  </div>
                ) : editMode ? (
                  <>
                    <div className="flex items-center gap-3 px-3 text-xs text-gray-400 font-medium uppercase tracking-wide">
                      <div className="flex-1">Тема</div>
                      <div className="w-20 text-center">Баллы</div>
                      <div className="w-36 text-center">Открывается</div>
                      <div className="w-10" />
                    </div>
                    <div className="space-y-3">
                      {modules.map(mod => (
                        <ModuleCard
                          key={mod.id}
                          module={mod}
                          canEdit={canEdit}
                          editMode={editMode}
                          hwStats={hwStats}
                          onSaveModule={handleSaveModule}
                          onDeleteModule={handleDeleteModule}
                          onSaveTopic={handleSaveTopic}
                          onDeleteTopic={handleDeleteTopic}
                          onAddTopic={handleAddTopic}
                          onOpenMaterials={openMaterials}
                        />
                      ))}
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleAddModule} loading={addingMod}>
                      <Plus size={15} className="mr-1.5" />Добавить модуль
                    </Button>
                  </>
                ) : (
                  <HwTable
                    modules={modules}
                    hwStats={hwStats}
                    hwByTopic={hwByTopic}
                    groupId={selectedGroupId}
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
              />
            )}

            {/* Settings tab */}
            {tab === 'settings' && canEdit && (
              <CourseSettings
                course={selectedCourse}
                onSave={v => saveCourse(selectedCourse.id, v)}
              />
            )}
          </div>
        )}
      </div>
    </div>

    <TopicMaterialsModal
      open={!!matTopic}
      onClose={() => setMatTopic(null)}
      topicId={matTopic?.topic.id ?? null}
      topicTitle={matTopic?.topic.title ?? ''}
      moduleTitle={matTopic?.moduleTitle ?? ''}
    />
    </>
  )
}

// ── helpers used by CourseSettings ──────────────────────────────────────────
function QuickDateBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
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
