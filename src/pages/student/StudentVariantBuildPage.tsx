import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Trash2, Hammer, BookOpen, ArrowLeft, Loader2 } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useCatalogTasksBatch } from '@/hooks/useCatalog'
import { useCreateSelfBuiltVariant, type SelfBuiltVariantTaskInput } from '@/hooks/useVariants'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'

const MAX_ITEMS = 50
const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

export function StudentVariantBuildPage() {
  const navigate = useNavigate()
  const { items, removeItem, moveItem, clearCart } = useCartStore()
  const { create, saving, error: createError } = useCreateSelfBuiltVariant()

  const [title,    setTitle]    = useState('')
  const [subject,  setSubject]  = useState<'math' | 'physics'>('math')
  const [examType, setExamType] = useState<'ege' | 'oge'>('ege')

  const taskIds = useMemo(() => items.map(i => i.catalog_task_id), [items])
  const { tasks, loading: tasksLoading } = useCatalogTasksBatch(taskIds)
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])

  const overLimit = items.length > MAX_ITEMS

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="w-12 h-12 text-gray-300 mx-auto" />
        <h1 className="text-xl font-bold text-gray-900">Вариант пока пуст</h1>
        <p className="text-gray-500">Добавьте задания из каталога — до {MAX_ITEMS} штук</p>
        <Link to="/catalog" className="inline-flex items-center gap-2 text-blue-600 hover:underline">
          <ArrowLeft size={16} /> Перейти в каталог
        </Link>
      </div>
    )
  }

  const handleCreate = async () => {
    const trimmed = title.trim()
    if (!trimmed || overLimit) return

    const payload: SelfBuiltVariantTaskInput[] = items.map(item => {
      const task = taskById.get(item.catalog_task_id)
      return {
        task_id:    item.catalog_task_id,
        section_id: task?.section_id ?? null,
        topic_id:   null,
      }
    })

    const studentAssignmentId = await create({
      title: trimmed,
      subject,
      examType,
      items: payload,
    })

    if (studentAssignmentId) {
      clearCart()
      navigate(`/student/variants/${studentAssignmentId}`)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/catalog" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft size={14} /> Каталог
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Собрать вариант самому</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {items.length} задание(й){overLimit && <span className="text-red-600 font-medium"> — максимум {MAX_ITEMS}</span>}
          </p>
        </div>
        <button
          onClick={clearCart}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={15} />
          Очистить
        </button>
      </div>

      <div className="space-y-3">
        {tasksLoading ? (
          <div className="py-8 text-center"><Loader2 size={22} className="animate-spin text-primary-500 mx-auto" /></div>
        ) : (
          items.map((item, idx) => (
            <BuildItemRow
              key={item.catalog_task_id}
              taskId={item.catalog_task_id}
              number={idx + 1}
              examPart={taskById.get(item.catalog_task_id)?.exam_part ?? null}
              statementHtml={taskById.get(item.catalog_task_id)?.statement_html}
              assets={taskById.get(item.catalog_task_id)?.assets}
              extId={taskById.get(item.catalog_task_id)?.external_id}
              onRemove={() => removeItem(item.catalog_task_id)}
              onMoveUp={idx > 0 ? () => moveItem(idx, idx - 1) : undefined}
              onMoveDown={idx < items.length - 1 ? () => moveItem(idx, idx + 1) : undefined}
            />
          ))
        )}
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Начать вариант</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            data-testid="self-build-title-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Например: Тренировка перед пробником"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Предмет</label>
            <select
              value={subject}
              onChange={e => setSubject(e.target.value as 'math' | 'physics')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(['math', 'physics'] as const).map(s => <option key={s} value={s}>{SUBJECT_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Экзамен</label>
            <select
              value={examType}
              onChange={e => setExamType(e.target.value as 'ege' | 'oge')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(['ege', 'oge'] as const).map(e => <option key={e} value={e}>{EXAM_LABELS[e]}</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Часть 1 проверяется автоматически. Часть 2 (или задачи без размеченной части)
          — вы проверяете себя сами по решению и критериям после завершения варианта;
          эти баллы нигде не сохраняются.
        </p>

        {createError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{createError}</p>
        )}

        <button
          data-testid="self-build-submit"
          onClick={handleCreate}
          disabled={!title.trim() || saving || overLimit}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg
            bg-blue-600 text-white text-sm font-medium
            hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
          {saving ? 'Создаём…' : 'Начать вариант'}
        </button>
      </div>
    </div>
  )
}

function BuildItemRow({
  taskId, number, examPart, statementHtml, assets, extId, onRemove, onMoveUp, onMoveDown,
}: {
  taskId: string
  number: number
  examPart: number | null
  statementHtml?: string
  assets?: { id: string; tex_session_id: number | null; kind: string; storage_path: string; alt: string | null; position: number }[]
  extId?: number
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const partLabel = examPart === 1 ? 'Часть 1 · автопроверка' : examPart === 2 ? 'Часть 2 · самопроверка' : 'Часть не указана · самопроверка'
  const partClass = examPart === 1 ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'

  return (
    <div data-testid="self-build-item" className="flex items-start gap-3 bg-white rounded-xl border border-gray-200 p-4">
      <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center bg-gray-100 rounded text-xs font-medium text-gray-500 mt-0.5">
        {number}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {extId != null && <span className="text-xs text-gray-400">Задача #{extId}</span>}
          <span data-testid={`self-build-item-part-${taskId}`} className={`text-xs font-medium rounded-full px-2 py-0.5 ${partClass}`}>
            {partLabel}
          </span>
        </div>
        {statementHtml ? (
          <div className="line-clamp-3 overflow-hidden">
            <TaskContentRenderer html={resolveTaskHtml(statementHtml, assets ?? [])} />
          </div>
        ) : (
          <p className="text-sm text-gray-400">Загрузка…</p>
        )}
      </div>

      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        {onMoveUp && (
          <button onClick={onMoveUp} title="Выше" className="text-gray-300 hover:text-gray-600 transition-colors text-xs">▲</button>
        )}
        {onMoveDown && (
          <button onClick={onMoveDown} title="Ниже" className="text-gray-300 hover:text-gray-600 transition-colors text-xs">▼</button>
        )}
        <button
          onClick={onRemove}
          title="Убрать из варианта"
          aria-label={`Убрать задачу ${number}`}
          className="text-gray-300 hover:text-red-500 transition-colors mt-1"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}
