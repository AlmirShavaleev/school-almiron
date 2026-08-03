import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { isTopicOpen, topicToggleLabel, type TopicOpenState } from '@/lib/topicAvailability'

/**
 * Тумблер открытости темы прямо в строке списка программы.
 *
 * Один компонент на ВСЕ списки тем у преподавателя (их четыре: программа с
 * перетаскиванием, таблица ДЗ, матрица материалов, раздел домашних заданий).
 * Состояние считается только через `topicAvailability.ts` — зеркало SQL-правила
 * `topic_open_now`. Своей копии условия здесь нет и быть не должно: в §59 таких
 * копий нашлось шесть, и сведение их в одно место было половиной той работы.
 *
 * Переключение оптимистичное: строка перекрашивается сразу, а если запись не
 * прошла — возвращается как была. Ждать ответа базы ради галочки в списке
 * из двадцати тем — значит сделать список неотзывчивым.
 */
export function TopicOpenToggle({
  topic,
  onToggle,
  className,
}: {
  topic: TopicOpenState
  /** Пишет is_open. Бросает — тумблер откатится сам. */
  onToggle: (isOpen: boolean) => Promise<void>
  className?: string
}) {
  // null — показываем настоящее состояние; иначе временно своё, до ответа базы.
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  const realOpen = isTopicOpen(topic)
  const open = optimistic ?? realOpen
  // Пока идёт оптимистичная запись, подпись обязана соответствовать показанному
  // состоянию, а не старому: иначе выйдет зелёная плашка со словом «Закрыта».
  const label = optimistic === null
    ? topicToggleLabel(topic)
    : (optimistic ? 'Открыта' : 'Закрыта')

  async function handleClick(e: React.MouseEvent) {
    // Строка темы кликабельна целиком — без этого тумблер заодно открывал бы
    // тему или модалку материалов.
    e.stopPropagation()
    e.preventDefault()
    if (saving) return

    const next = !open
    setOptimistic(next)
    setSaving(true)
    try {
      await onToggle(next)
      setOptimistic(null)
    } catch {
      setOptimistic(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label={open ? 'Тема открыта' : 'Тема закрыта'}
      data-testid="topic-row-open-toggle"
      onClick={handleClick}
      title={open ? 'Открыта для учеников. Нажмите, чтобы закрыть' : 'Закрыта. Нажмите, чтобы открыть'}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
        open
          ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
          : 'border-gray-200 bg-gray-100 text-gray-500 hover:bg-gray-200',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-green-500' : 'bg-gray-400')} />
      {label}
      {saving && <Loader2 size={9} className="animate-spin" />}
    </button>
  )
}
