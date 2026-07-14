import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Trash2, Save, BookOpen, ArrowLeft, FileDown } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useSaveCollection } from '@/hooks/useCollections'
import { useCatalogTasksBatch, type CatalogTask, type CatalogTaskAsset } from '@/hooks/useCatalog'
import { getLessonHomeworkDraftContext, clearLessonHomeworkDraftContext } from '@/utils/lessonHomeworkDraft'
import type { WorkType } from '@/types/collections'
import { WORK_TYPE_LABELS } from '@/types/collections'
import { useAuthStore } from '@/store/authStore'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'

export function CartPage() {
  const navigate = useNavigate()
  const { items, removeItem, clearCart } = useCartStore()
  const profile = useAuthStore(s => s.profile)
  const { save, loading: saving, error: saveError } = useSaveCollection()

  const [title,    setTitle]    = useState('')
  const [subject,  setSubject]  = useState<'Математика' | 'Физика'>('Математика')
  const [workType, setWorkType] = useState<WorkType>('custom')
  const [showStudentPrintPanel, setShowStudentPrintPanel] = useState(false)

  const isStudent = profile?.role === 'student'
  const taskIds = useMemo(() => items.map(item => item.catalog_task_id), [items])
  const { tasks: batchTasks, loading: batchLoading } = useCatalogTasksBatch(taskIds)

  const taskMap = useMemo(
    () => new Map(batchTasks.map(task => [task.id, task])),
    [batchTasks],
  )

  const printItems: PrintableItem[] = useMemo(
    () => items.map((item, index) => ({
      id: `${item.catalog_task_id}-${index}`,
      task: taskMap.get(item.catalog_task_id),
      customNumber: null,
    })),
    [items, taskMap],
  )

  const printableTasks = useMemo(
    () => printItems.filter((item): item is PrintableItem & { task: NonNullable<PrintableItem['task']> } => !!item.task),
    [printItems],
  )

  const printSubject = printableTasks[0]?.task.subject ?? subject
  const printExamType = printableTasks[0]?.task.exam_type ?? ''
  const canShowStudentPrintPanel = !batchLoading && printableTasks.length > 0 && printableTasks.length === items.length

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
            task={taskMap.get(item.catalog_task_id)}
            number={idx + 1}
            onRemove={() => removeItem(item.catalog_task_id)}
          />
        ))}
      </div>

      {isStudent ? (
        <>
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold text-gray-900">PDF из корзины</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Та же панель печати, что у учителя: превью, рабочий лист, ответы и все настройки доступны прямо из корзины.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStudentPrintPanel(v => !v)}
                disabled={!canShowStudentPrintPanel}
                aria-expanded={showStudentPrintPanel}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  showStudentPrintPanel
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <FileDown size={16} />
                PDF
              </button>
            </div>

            {batchLoading && (
              <p className="text-sm text-gray-500">Подготавливаем задачи для PDF…</p>
            )}
            {!batchLoading && printableTasks.length !== items.length && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                Не все задачи из корзины удалось загрузить для печати. Проверьте состав корзины и попробуйте ещё раз.
              </p>
            )}
          </div>

          {showStudentPrintPanel && canShowStudentPrintPanel && (
            <VariantPrintPanel
              className="bg-white rounded-2xl border border-gray-200 p-4"
              items={printableTasks}
              subject={printSubject}
              examType={printExamType}
              initialTitle="Подборка из каталога"
            />
          )}
        </>
      ) : (
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
      )}
    </div>
  )
}

// ── Task row in cart ──────────────────────────────────────────────────────────

function CartItemRow({
  task,
  number,
  onRemove,
}: {
  task:     (CatalogTask & { assets?: CatalogTaskAsset[] }) | undefined
  number:   number
  onRemove: () => void
}) {
  return (
    task ? (
      <TaskDisplayCard
        task={task}
        number={number}
        extraActions={(
          <>
            <span className="text-xs text-gray-400">
              #{task.external_id} · {task.subject} · {task.exam_type.toUpperCase()}
            </span>
            <button
              onClick={onRemove}
              title="Убрать из корзины"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
            >
              <Trash2 size={14} />
              Убрать
            </button>
          </>
        )}
      />
    ) : (
      <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4">
        <span className="w-7 h-7 flex items-center justify-center bg-gray-100 rounded text-xs font-medium text-gray-400">
          {number}
        </span>
        <p className="text-sm text-gray-400 flex-1">Задача недоступна</p>
        <button
          onClick={onRemove}
          title="Убрать из корзины"
          className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
    )
  )
}
