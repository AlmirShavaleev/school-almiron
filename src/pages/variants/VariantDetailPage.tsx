import { useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Edit2, Copy, BookOpen, FileText, Loader2, AlertTriangle, Send, List } from 'lucide-react'
import { useVariantDetail } from '@/hooks/useVariants'
import { useAuthStore } from '@/store/authStore'
import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/store/toastStore'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

export function VariantDetailPage() {
  const { variantId } = useParams<{ variantId: string }>()
  const navigate       = useNavigate()
  const { profile }    = useAuthStore()

  const { variant, items, loading, error } = useVariantDetail(variantId)

  const printableItems: PrintableItem[] = useMemo(
    () => items.map(item => ({
      id: item.id,
      task: item.task,
      customNumber: null,
    })),
    [items],
  )

  const canEdit = profile && (
    profile.role === 'admin' ||
    profile.role === 'owner' ||
    (profile.role === 'teacher' && variant?.created_by === profile.id)
  )

  async function handleDuplicate() {
    if (!variant) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error: e } = await db.rpc('save_variant_atomic', {
      p_variant_id:  null,
      p_title:       `${variant.title} (копия)`,
      p_description: variant.description,
      p_subject:     variant.subject,
      p_exam_type:   variant.exam_type,
      p_status:      'draft',
      p_settings:    variant.settings,
      p_items:       items.map((item, idx) => ({
        task_id:    item.task_id,
        pos:        idx + 1,
        section_id: item.section_id,
        topic_id:   item.topic_id,
        points:     item.points,
      })),
    })
    if (e) { toast.error('Не удалось дублировать'); return }
    toast.success('Вариант продублирован')
    navigate(`/variants/${data}`)
  }

  if (loading) return <DetailSkeleton />

  if (error || !variant) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium">{error ?? 'Вариант не найден'}</p>
        <Link to="/variants" className="mt-3 text-sm text-primary-600 hover:underline block">
          Вернуться к списку
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Back */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/variants')}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <nav className="text-sm text-gray-500 flex items-center gap-1.5">
          <Link to="/variants" className="hover:text-primary-600">Варианты</Link>
          <span>/</span>
          <span className="text-gray-700 truncate max-w-xs">{variant.title}</span>
        </nav>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-gray-900 truncate">{variant.title}</h1>
              <Badge variant={variant.status === 'ready' ? 'success' : 'default'}>
                {variant.status === 'ready' ? 'Готов' : 'Черновик'}
              </Badge>
            </div>
            {variant.description && (
              <p className="text-sm text-gray-500 mt-1">{variant.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 flex-wrap">
              <span className="flex items-center gap-1.5">
                <BookOpen size={14} />
                {SUBJECT_LABELS[variant.subject]} · {EXAM_LABELS[variant.exam_type]}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText size={14} />
                {variant.tasks_count} задач
              </span>
              {variant.created_by_profile && (
                <span>{variant.created_by_profile.full_name}</span>
              )}
              <span>
                Обновлён {format(new Date(variant.updated_at), 'd MMM yyyy', { locale: ru })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => navigate(`/variants/${variant.id}/assignments`)}>
                  <List size={14} className="mr-1.5" /> Назначения
                </Button>
                <Button onClick={() => navigate(`/variants/${variant.id}/assign`)}>
                  <Send size={14} className="mr-1.5" /> Назначить
                </Button>
              </>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => navigate(`/variant-builder/${variant.id}`)}>
                <Edit2 size={14} className="mr-1.5" /> Редактировать
              </Button>
            )}
            <Button variant="secondary" onClick={handleDuplicate}>
              <Copy size={14} className="mr-1.5" /> Дублировать
            </Button>
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            <FileText size={32} className="mx-auto mb-2 text-gray-300" />
            <p>В этом варианте нет задач</p>
            {canEdit && (
              <button
                onClick={() => navigate(`/variant-builder/${variant.id}`)}
                className="mt-2 text-sm text-primary-600 hover:underline"
              >
                Добавить задачи
              </button>
            )}
          </div>
        ) : (
          items.map((item, idx) =>
            item.task ? (
              <CatalogTaskContent
                key={item.id}
                task={item.task}
                variantNumber={idx + 1}
                showControls={true}
              />
            ) : (
              <div key={item.id} className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={14} className="animate-spin" /> Задача не найдена
              </div>
            )
          )
        )}
      </div>

      {/* PDF export — inline live preview, no modal/route */}
      {items.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Экспорт в PDF</h2>
          <VariantPrintPanel
            items={printableItems}
            subject={variant.subject}
            examType={variant.exam_type}
          />
        </div>
      )}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 animate-pulse space-y-4">
      <div className="h-6 bg-gray-200 rounded w-48" />
      <div className="h-28 bg-gray-100 rounded-xl" />
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-xl" />)}
    </div>
  )
}
