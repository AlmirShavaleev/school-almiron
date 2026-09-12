import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { ListPlus, X, Loader2 } from 'lucide-react'
import { useAttachSelectionStore, useAttachTargetStore, leaveAttachMode } from '@/store/attachStore'
import { useAttachTasksToTopic, fetchAttachTarget, type AttachPreview } from '@/hooks/useTopicTaskAttach'
import { toast } from '@/store/toastStore'

/**
 * Режим подбора задач к уроку поверх каталога (§164).
 *
 * Обёртка маршрутов каталога, а не правка его страниц: каталог показывает свои
 * задачи как показывал, а режим добавляет сверху полосу «кому подбираем» и
 * меняет подпись на плавающей кнопке. Всё, что каталог про это знает, —
 * `useActiveSelection` в кнопке «В подборку».
 */
export function CatalogAttachMode() {
  useSeedTargetFromUrl()

  return (
    <>
      <AttachContextBar />
      <Outlet />
      <AttachFab />
    </>
  )
}

/**
 * Вход по адресу `/catalog?attachTo=<id>`.
 *
 * Обычно цель уже лежит в хранилище — её положила страница темы, у неё есть и
 * название темы, и название курса. Адрес нужен второй вкладке и обновлению
 * страницы: по нему режим поднимается сам, названия дочитываются запросом.
 */
function useSeedTargetFromUrl() {
  const [params, setParams] = useSearchParams()
  const target    = useAttachTargetStore(s => s.target)
  const setTarget = useAttachTargetStore(s => s.setTarget)
  const attachTo  = params.get('attachTo')

  useEffect(() => {
    if (!attachTo) return

    // Цель уже та самая — просто убираем параметр, чтобы он не ездил дальше
    // по ссылкам каталога.
    if (target?.topicId === attachTo) {
      setParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('attachTo')
        return next
      }, { replace: true })
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const found = await fetchAttachTarget(attachTo)
        // Не достучались до названий — режим не включаем: полоса без темы
        // врала бы сильнее, чем её отсутствие.
        if (!cancelled && found) setTarget(found)
      } finally {
        if (!cancelled) {
          setParams(prev => {
            const next = new URLSearchParams(prev)
            next.delete('attachTo')
            return next
          }, { replace: true })
        }
      }
    })()

    return () => { cancelled = true }
  }, [attachTo, target?.topicId, setTarget, setParams])
}

function AttachContextBar() {
  const target   = useAttachTargetStore(s => s.target)
  const navigate = useNavigate()

  if (!target) return null

  return (
    <div
      data-testid="attach-context-bar"
      className="sticky top-0 z-30 -mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1
        border-b border-amber-200 bg-amber-50 px-4 py-2 sm:mx-0 sm:rounded-xl sm:border"
    >
      <ListPlus size={15} className="shrink-0 text-amber-700" />
      <span className="min-w-0 flex-1 text-sm text-amber-900">
        Подбираем задачи к теме «{target.topicTitle}»
        {target.courseTitle && <span className="text-amber-700"> · {target.courseTitle}</span>}
      </span>
      <button
        type="button"
        onClick={() => {
          const back = target.returnTo
          leaveAttachMode()
          navigate(back)
        }}
        className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100"
      >
        Отменить
      </button>
    </div>
  )
}

/**
 * Та же кнопка в том же углу, что и «Подборка · N», — другой подписью и другим
 * действием. Слот из `board/007` (§153) в `main` ещё не слит; когда приедет,
 * кнопка переедет в него одной правкой класса.
 */
function AttachFab() {
  const target = useAttachTargetStore(s => s.target)
  const items  = useAttachSelectionStore(s => s.items)
  const [confirming, setConfirming] = useState(false)

  if (!target || items.length === 0) return null

  return (
    <>
      <button
        type="button"
        data-testid="attach-fab"
        onClick={() => setConfirming(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5
          bg-amber-600 text-white px-4 py-2.5 rounded-full shadow-lg
          hover:bg-amber-700 transition-colors"
        aria-label={`Прикрепить к теме — ${items.length} заданий`}
      >
        <ListPlus size={18} />
        <span className="text-sm font-medium">Прикрепить к теме · {items.length}</span>
      </button>

      {confirming && <AttachConfirmDialog onClose={() => setConfirming(false)} />}
    </>
  )
}

function AttachConfirmDialog({ onClose }: { onClose: () => void }) {
  const target   = useAttachTargetStore(s => s.target)
  const items    = useAttachSelectionStore(s => s.items)
  const navigate = useNavigate()
  const { preview, attach, busy, error } = useAttachTasksToTopic()
  const [composition, setComposition] = useState<AttachPreview | null>(null)

  const taskIds = items.map(i => i.catalog_task_id)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await preview(taskIds)
      if (!cancelled) setComposition(data)
    })()
    return () => { cancelled = true }
    // Состав считаем по набору задач, а не по каждому изменению массива-обёртки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIds.join(','), preview])

  if (!target) return null

  async function confirm() {
    if (!target) return
    const result = await attach(target.topicId, taskIds)
    if (!result) return

    const back = target.returnTo
    leaveAttachMode()
    toast.success(
      result.skipped > 0
        ? `Прикреплено ${result.added} · уже были ${result.skipped} · всего ${result.total}`
        : `Прикреплено ${result.added} · всего ${result.total}`
    )
    navigate(back)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            Прикрепить задачи к теме
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          «{target.topicTitle}»
          {target.courseTitle && <span className="text-gray-400"> · {target.courseTitle}</span>}
        </p>

        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {composition === null ? (
            <span className="flex items-center gap-2 text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Считаем состав…
            </span>
          ) : (
            <>
              <div className="font-medium text-gray-900">Задач: {composition.total}</div>
              <div className="mt-0.5 text-xs text-gray-500">
                с автопроверкой — {composition.auto_checkable} · самопроверка по решению — {composition.self_checked}
                {composition.part_two > 0 && <> · вторая часть — {composition.part_two}</>}
              </div>
            </>
          )}
        </div>

        <p className="mt-2 text-xs text-gray-400">
          Задачи добавятся к уже прикреплённым. Те, что в теме уже есть, не задвоятся.
        </p>

        {error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Отмена
          </button>
          <button
            type="button"
            data-testid="attach-confirm"
            disabled={busy || taskIds.length === 0}
            onClick={() => void confirm()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium
              text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Прикрепить
          </button>
        </div>
      </div>
    </div>
  )
}
