import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, BookOpen, ClipboardList, Layers, Loader2 } from 'lucide-react'
import { useCollections, useCollectionItemCounts, useArchiveCollection } from '@/hooks/useCollections'
import { WORK_TYPE_LABELS } from '@/types/collections'
import type { TaskCollection } from '@/types/collections'
import { plural } from '@/lib/plural'
import { formatUpdatedAt } from '@/utils/format'
import { toast } from '@/store/toastStore'

/**
 * «Мои подборки» — список сохранённых подборок каталога (§188).
 *
 * До этого экрана подборка существовала, но найти её было негде: корзина
 * каталога сохраняла её и уводила на `/collections/:id`, и стоило уйти с этой
 * страницы, как вернуться можно было только по прямой ссылке. Владелец собрал
 * подборку и не нашёл её — отсюда карточка.
 *
 * Данные берёт `useCollections()`: свои (`created_by`), неархивные, свежие
 * сверху. Числа заданий — одним запросом на весь список
 * (`useCollectionItemCounts`), а не по запросу на строку.
 */
export function CollectionsPage() {
  const { collections, loading, error, reload } = useCollections()

  // Убранное в архив гасим на месте, а не перезапросом списка: строка исчезает
  // мгновенно, и ответ базы не нужен для того, чтобы экран стал правдой —
  // фильтр `is_archived = false` даст тот же результат при следующей загрузке.
  const [archivedIds, setArchivedIds] = useState<string[]>([])
  const visible = collections.filter(c => !archivedIds.includes(c.id))

  // Счётчики просим по ПОЛНОМУ списку, а не по видимому: иначе каждое
  // «в архив» перезапрашивало бы их заново ради чисел, которые уже известны.
  const allIds = useMemo(() => collections.map(c => c.id), [collections])
  const counts = useCollectionItemCounts(allIds)

  const { archive, pendingId } = useArchiveCollection()

  async function handleArchive(collection: TaskCollection) {
    const ok = await archive(collection.id)
    if (!ok) { toast.error('Не удалось убрать подборку в архив'); return }
    setArchivedIds(ids => [...ids, collection.id])
    toast.success('Подборка убрана в архив')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={22} className="text-primary-600" />
            <h1 className="text-xl font-bold text-gray-900">Мои подборки</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Сохранённые подборки заданий из каталога
          </p>
        </div>
        <Link
          to="/catalog"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
        >
          <ClipboardList size={16} />
          В каталог
        </Link>
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
      ) : visible.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2">
          {visible.map(collection => (
            <CollectionRow
              key={collection.id}
              collection={collection}
              count={counts[collection.id]}
              archiving={pendingId === collection.id}
              onArchive={() => handleArchive(collection)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function CollectionRow({
  collection,
  count,
  archiving,
  onArchive,
}: {
  collection: TaskCollection
  count:      number | undefined
  archiving:  boolean
  onArchive:  () => void
}) {
  const navigate = useNavigate()
  const href = `/collections/${collection.id}`

  /**
   * Открывает карточку целиком (§200). Клики по вложенной ссылке и по кнопке
   * «в архив» сюда доходить не должны: ссылка уводит сама, а архив — вообще не
   * про открытие. Модификаторы отдаём браузеру: Ctrl/Cmd-клик по карточке — это
   * просьба открыть в новой вкладке, а не перейти в текущей.
   */
  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if ((e.target as HTMLElement).closest('a, button')) return
    navigate(href)
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault() // пробел иначе прокручивает страницу
    navigate(href)
  }

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Открыть подборку «${collection.title}»`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 cursor-pointer hover:border-primary-300 hover:bg-primary-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 transition-all"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Ссылка, а не просто текст: адрес видно в статусной строке, работает
              средняя кнопка и «открыть в новой вкладке». С клавиатуры цель одна —
              сама карточка, поэтому ссылка из обхода Tab убрана (`tabIndex={-1}`):
              два стопа подряд на один и тот же адрес только мешают. */}
          <Link
            to={href}
            tabIndex={-1}
            className="font-medium text-gray-800 hover:text-primary-700 truncate"
          >
            {collection.title}
          </Link>
          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full whitespace-nowrap">
            {WORK_TYPE_LABELS[collection.work_type] ?? collection.work_type}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
          <span>{collection.subject}</span>
          <span className="flex items-center gap-1">
            <BookOpen size={11} />
            {count == null
              ? '…'
              : `${count} ${plural(count, 'задание', 'задания', 'заданий')}`}
          </span>
          <span>{formatUpdatedAt(collection.updated_at)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* «Глазик» здесь был единственным способом открыть подборку и потому
            же оказался лишним, как только открывает вся карточка (§200).
            Архив остаётся: это не «открыть», и промахнуться по нему нельзя. */}
        <RowBtn
          icon={<Archive size={15} />}
          title="В архив"
          onClick={onArchive}
          disabled={archiving}
        />
      </div>
    </div>
  )
}

/**
 * Кнопка действия внутри кликабельной карточки. Всплытие гасит сама: иначе
 * «в архив» заодно открывало бы подборку, а человек, промахнувшийся мимо
 * архива, получал бы два действия вместо одного.
 */
function RowBtn({ icon, title, onClick, disabled }: {
  icon: React.ReactNode; title: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
    >
      {icon}
    </button>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────

/**
 * Пустая таблица на пустом месте только сообщает «тут ничего нет» и бросает
 * человека; отсюда прямая ссылка туда, где подборка и рождается.
 */
function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
      <Layers size={40} className="text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500 font-medium">Подборок пока нет</p>
      <p className="text-sm text-gray-400 mt-1">
        Подборка собирается в каталоге: отметьте задания и сохраните корзину.
      </p>
      <Link
        to="/catalog"
        className="inline-block mt-3 text-sm text-primary-600 hover:underline"
      >
        Перейти в каталог заданий
      </Link>
    </div>
  )
}
