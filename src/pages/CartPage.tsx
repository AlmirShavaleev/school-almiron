import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Trash2, Save, BookOpen, ArrowLeft } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useSaveCollection } from '@/hooks/useCollections'
import { useCatalogTask } from '@/hooks/useCatalog'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { getLessonHomeworkDraftContext, clearLessonHomeworkDraftContext } from '@/utils/lessonHomeworkDraft'
import type { WorkType } from '@/types/collections'
import { WORK_TYPE_LABELS } from '@/types/collections'

export function CartPage() {
  const navigate = useNavigate()
  const { items, removeItem, clearCart } = useCartStore()
  const { save, loading: saving, error: saveError } = useSaveCollection()

  const [title,    setTitle]    = useState('')
  const [subject,  setSubject]  = useState<'Математика' | 'Физика'>('Математика')
  const [workType, setWorkType] = useState<WorkType>('custom')

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="w-12 h-12 text-gray-300 mx-auto" />
        <h1 className="text-xl font-bold text-gray-900">Подборка пуста</h1>
        <p className="text-gray-500">Добавьте задания из каталога</p>
        <Link to="/catalog" className="inline-flex items-center gap-2 text-blue-600 hover:underline">
          <ArrowLeft size={16} /> Перейти в каталог
        </Link>
      </div>
    )
  }

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) return

    const id = await save({
      collection_id: null,
      title:         trimmed,
      description:   null,
      subject,
      work_type:     workType,
      items:         items.map((item, idx) => ({
        catalog_task_id: item.catalog_task_id,
        position:        idx + 1,
        custom_number:   null,
      })),
    })

    if (id) {
      // Only clear cart after confirmed successful save
      clearCart()

      // If we got here via "Собрать новую подборку" from a lesson card,
      // return to that lesson with the new collection preselected instead
      // of the normal /collections/:id destination. Separate localStorage
      // key from the cart — never interferes with the plain cart flow.
      const draft = getLessonHomeworkDraftContext()
      if (draft) {
        clearLessonHomeworkDraftContext()
        navigate(`/lessons/${draft.lessonId}?assignCollection=${id}`)
      } else {
        navigate(`/collections/${id}`)
      }
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/catalog" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft size={14} /> Каталог
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Корзина</h1>
          <p className="text-gray-500 text-sm mt-0.5">{items.length} задание(й)</p>
        </div>
        <button
          onClick={clearCart}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={15} />
          Очистить
        </button>
      </div>

      {/* Items */}
      <div className="space-y-3">
        {items.map((item, idx) => (
          <CartItemRow
            key={item.catalog_task_id}
            taskId={item.catalog_task_id}
            number={idx + 1}
            onRemove={() => removeItem(item.catalog_task_id)}
          />
        ))}
      </div>

      {/* Save form */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Сохранить подборку</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Например: Кинематика — контрольная"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Предмет</label>
            <select
              value={subject}
              onChange={e => setSubject(e.target.value as 'Математика' | 'Физика')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option>Математика</option>
              <option>Физика</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Тип работы</label>
            <select
              value={workType}
              onChange={e => setWorkType(e.target.value as WorkType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(Object.entries(WORK_TYPE_LABELS) as [WorkType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>
        )}

        <button
          onClick={handleSave}
          disabled={!title.trim() || saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
            bg-blue-600 text-white text-sm font-medium
            hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={16} />
          {saving ? 'Сохраняем…' : 'Сохранить подборку'}
        </button>
      </div>
    </div>
  )
}

// ── Task row in cart ──────────────────────────────────────────────────────────

function CartItemRow({
  taskId,
  number,
  onRemove,
}: {
  taskId:   string
  number:   number
  onRemove: () => void
}) {
  const { task, loading } = useCatalogTask(taskId)

  return (
    <div className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 p-4">
      <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center bg-gray-100 rounded text-xs font-medium text-gray-500 mt-0.5">
        {number}
      </span>

      <div className="flex-1 min-w-0">
        {loading ? (
          <div className="h-4 bg-gray-200 rounded animate-pulse w-48" />
        ) : task ? (
          <>
            <p className="text-xs text-gray-400 mb-1">
              Задача #{task.external_id} · {task.subject} · {task.exam_type.toUpperCase()}
            </p>
            <div className="line-clamp-3 overflow-hidden">
              <TaskContentRenderer
                html={resolveTaskHtml(task.statement_html, task.assets)}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">Задача не найдена</p>
        )}
      </div>

      <button
        onClick={onRemove}
        title="Убрать из корзины"
        className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors mt-0.5"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}
