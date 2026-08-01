import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useCatalogTasksBatch } from '@/hooks/useCatalog'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'

export function StudentVariantBuildPage() {
  const { items, removeItem, clearCart } = useCartStore()

  const taskIds = useMemo(() => items.map(item => item.catalog_task_id), [items])
  const { tasks, loading } = useCatalogTasksBatch(taskIds)

  const taskMap = useMemo(
    () => new Map(tasks.map(task => [task.id, task])),
    [tasks],
  )

  const printItems: PrintableItem[] = useMemo(
    () => items.map((item, index) => ({
      id: `${item.catalog_task_id}-${index}`,
      task: taskMap.get(item.catalog_task_id),
      customNumber: null,
    })),
    [items, taskMap],
  )

  const printableItems = useMemo(
    () => printItems.filter((item): item is PrintableItem & { task: NonNullable<PrintableItem['task']> } => !!item.task),
    [printItems],
  )

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-10 text-center space-y-4">
        <BookOpen className="w-12 h-12 text-gray-300 mx-auto" />
        <h1 className="text-xl font-bold text-gray-900">Корзина пуста</h1>
        <p className="text-gray-500">Добавьте задания из каталога, чтобы открыть PDF-превью</p>
        <Link to="/catalog" className="inline-flex items-center gap-2 text-blue-600 hover:underline">
          <ArrowLeft size={16} /> Перейти в каталог
        </Link>
      </div>
    )
  }

  const printSubject = printableItems[0]?.task.subject ?? 'Математика'
  const printExamType = printableItems[0]?.task.exam_type ?? ''

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/cart" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft size={14} /> Вернуться в корзину
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">PDF из корзины</h1>
          <p className="text-sm text-gray-500 mt-1">
            Полноценная страница предпросмотра: слева задачи из корзины, справа та же панель печати, что у учителя.
          </p>
        </div>
        <button
          onClick={clearCart}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          Очистить корзину
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Задачи в подборке</h2>
                <p className="text-sm text-gray-500 mt-1">{items.length} задание(й)</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.catalog_task_id} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : (
            items.map((item, index) => {
              const task = taskMap.get(item.catalog_task_id)
              return task ? (
                <TaskDisplayCard
                  key={item.catalog_task_id}
                  task={task}
                  number={index + 1}
                  extraActions={(
                    <>
                      <span className="text-xs text-gray-400">
                        #{task.external_id} · {task.subject} · {task.exam_type.toUpperCase()}
                      </span>
                      <button
                        onClick={() => removeItem(item.catalog_task_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
                      >
                        Убрать
                      </button>
                    </>
                  )}
                />
              ) : (
                <div key={item.catalog_task_id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
                  <span className="w-7 h-7 flex items-center justify-center rounded bg-gray-100 text-xs font-medium text-gray-400">
                    {index + 1}
                  </span>
                  <p className="flex-1 text-sm text-gray-400">Задача недоступна</p>
                </div>
              )
            })
          )}
        </aside>

        <section className="min-w-0">
          {loading ? (
            <div className="h-80 rounded-2xl bg-gray-100 animate-pulse" />
          ) : printableItems.length === items.length ? (
            <VariantPrintPanel
              className="rounded-2xl border border-gray-200 bg-white p-4"
              items={printableItems}
              subject={printSubject}
              examType={printExamType}
              initialTitle="Подборка из каталога"
            />
          ) : (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Не все задачи из корзины удалось загрузить для печати. Вернитесь в корзину и проверьте состав подборки.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
