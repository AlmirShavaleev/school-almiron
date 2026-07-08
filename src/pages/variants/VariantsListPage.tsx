import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FilePlus2, Search, Filter, Edit2, Eye, Trash2, Copy,
  FileText, Loader2, BookOpen,
} from 'lucide-react'
import { useVariants, type TestVariant } from '@/hooks/useVariants'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }
const STATUS_LABELS:  Record<string, string> = { draft: 'Черновик', ready: 'Готов' }

export function VariantsListPage() {
  const navigate = useNavigate()
  const { profile } = useAuthStore()

  const [search,    setSearch]    = useState('')
  const [subject,   setSubject]   = useState('')
  const [examType,  setExamType]  = useState('')
  const [status,    setStatus]    = useState('')

  const filters = useMemo(() => ({
    subject:   subject   || undefined,
    exam_type: examType  || undefined,
    status:    status    || undefined,
    search:    search    || undefined,
  }), [subject, examType, status, search])

  const { variants, loading, error, reload, deleteVariant } = useVariants(filters)

  const isStaff = profile && ['admin', 'owner'].includes(profile.role)

  async function handleDuplicate(v: TestVariant) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error: e } = await db.rpc('save_variant_atomic', {
      p_variant_id:  null,
      p_title:       `${v.title} (копия)`,
      p_description: v.description,
      p_subject:     v.subject,
      p_exam_type:   v.exam_type,
      p_status:      'draft',
      p_settings:    v.settings,
      p_items:       [], // пустой — пользователь перегенерирует
    })
    if (e) { toast.error('Не удалось дублировать'); return }
    toast.success('Вариант продублирован как черновик')
    navigate(`/variant-builder/${data}`)
  }

  async function handleDelete(v: TestVariant) {
    if (!confirm(`Удалить вариант «${v.title}»? Это действие нельзя отменить.`)) return
    await deleteVariant(v.id)
    toast.success('Вариант удалён')
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <FileText size={22} className="text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Варианты заданий</h1>
        </div>
        <Button variant="primary" onClick={() => navigate('/variant-builder')}>
          <FilePlus2 size={16} className="mr-1.5" />
          Новый вариант
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>

        <Filter size={14} className="text-gray-400 hidden sm:block" />

        <select value={subject} onChange={e => setSubject(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-400">
          <option value="">Все предметы</option>
          <option value="math">Математика</option>
          <option value="physics">Физика</option>
        </select>

        <select value={examType} onChange={e => setExamType(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-400">
          <option value="">ЕГЭ / ОГЭ</option>
          <option value="ege">ЕГЭ</option>
          <option value="oge">ОГЭ</option>
        </select>

        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-400">
          <option value="">Все статусы</option>
          <option value="draft">Черновик</option>
          <option value="ready">Готов</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-primary-600" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-700">
          {error}
          <button onClick={reload} className="ml-2 underline text-sm">Повторить</button>
        </div>
      ) : variants.length === 0 ? (
        <EmptyState hasFilters={!!(search || subject || examType || status)} />
      ) : (
        <div className="space-y-2">
          {variants.map(v => (
            <VariantRow
              key={v.id}
              variant={v}
              showAuthor={!!isStaff}
              onOpen={() => navigate(`/variants/${v.id}`)}
              onEdit={() => navigate(`/variant-builder/${v.id}`)}
              onDuplicate={() => handleDuplicate(v)}
              onDelete={() => handleDelete(v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── VariantRow ────────────────────────────────────────────────────────────────

function VariantRow({
  variant, showAuthor,
  onOpen, onEdit, onDuplicate, onDelete,
}: {
  variant: TestVariant
  showAuthor: boolean
  onOpen: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 hover:border-gray-300 transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-800 truncate">{variant.title}</span>
          <Badge variant={variant.status === 'ready' ? 'success' : 'default'}>
            {STATUS_LABELS[variant.status]}
          </Badge>
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
            {SUBJECT_LABELS[variant.subject]} · {EXAM_LABELS[variant.exam_type]}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
          <span className="flex items-center gap-1">
            <BookOpen size={11} /> {variant.tasks_count} задач
          </span>
          {showAuthor && variant.created_by_profile && (
            <span>{variant.created_by_profile.full_name}</span>
          )}
          <span>
            {format(new Date(variant.updated_at), 'd MMM yyyy', { locale: ru })}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <ActionBtn icon={<Eye size={15} />}    title="Открыть"     onClick={onOpen} />
        <ActionBtn icon={<Edit2 size={15} />}  title="Редактировать" onClick={onEdit} />
        <ActionBtn icon={<Copy size={15} />}   title="Дублировать" onClick={onDuplicate} />
        <ActionBtn icon={<Trash2 size={15} />} title="Удалить"     onClick={onDelete} danger />
      </div>
    </div>
  )
}

function ActionBtn({ icon, title, onClick, danger }: {
  icon: React.ReactNode; title: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors ${
        danger
          ? 'text-gray-400 hover:text-red-600 hover:bg-red-50'
          : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      {icon}
    </button>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
      <FileText size={40} className="text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500 font-medium">
        {hasFilters ? 'Варианты не найдены' : 'У вас пока нет вариантов'}
      </p>
      {!hasFilters && (
        <button
          onClick={() => navigate('/variant-builder')}
          className="mt-3 text-sm text-primary-600 hover:underline"
        >
          Создать первый вариант
        </button>
      )}
    </div>
  )
}
