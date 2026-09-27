import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTopicTraining } from '@/hooks/useTopicTraining'
import { plural } from '@/lib/plural'
import { toast } from '@/store/toastStore'
import { SubtopicCode, TrainingMark } from '@/components/courseProgram/TopicTrainingStudent'
import { cn } from '@/utils/cn'

/**
 * Блок «Тренировка» в редакторе темы (§234).
 *
 * Только видимость: подтемы задачника раскладывает загрузчик
 * (`scripts/import-trenirovka.mjs`) в шаблон курса, в классы их доносит
 * синхронизация каркаса. Учитель класса решает одно — видят ли подтему его
 * ученики. Скрытие живёт в `topic_subtopic_hidden` этой темы, а не в
 * `is_visible`: синхронизация переносит `is_visible` из шаблона и затёрла бы
 * решение учителя при первой же правке каркаса.
 */
export function TopicTrainingEditor({ topicId }: { topicId: string }) {
  const { subtopics, loading, setSubtopicHidden } = useTopicTraining(topicId)
  const [saving, setSaving] = useState<string | null>(null)

  if (loading && subtopics.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-graphite-500">
        <Loader2 size={14} className="animate-spin" /> Тренировка…
      </div>
    )
  }
  if (subtopics.length === 0) return null

  const hiddenCount = subtopics.filter(s => s.hidden).length

  async function toggle(code: string, nextHidden: boolean) {
    setSaving(code)
    try {
      await setSubtopicHidden(code, nextHidden)
      toast.saved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section data-testid="topic-training-editor" className="rounded-card border border-graphite-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrainingMark />
        <span className="text-sm font-semibold text-graphite-900">
          {subtopics.length} {plural(subtopics.length, 'подтема', 'подтемы', 'подтем')}
        </span>
        {hiddenCount > 0 && (
          <span className="text-[13px] text-graphite-500">
            · скрыто {hiddenCount}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-graphite-500">
        Задачник по кодификатору приходит из шаблона курса. Здесь — только кто видит подтему в этом классе.
      </p>

      <ul className="mt-3 divide-y divide-graphite-200">
        {subtopics.map(s => {
          const visible = !s.hidden
          return (
            <li key={s.code} data-testid="training-editor-row" data-code={s.code} className="flex items-center gap-3 py-2.5">
              <SubtopicCode code={s.code} />
              <span className="min-w-0 flex-1">
                <span className={cn('block break-words text-sm leading-snug', visible ? 'text-graphite-900' : 'text-graphite-500 line-through decoration-graphite-300')}>
                  {s.title || `Подтема ${s.code}`}
                </span>
                <span className="block text-[13px] text-graphite-500">
                  {s.total} {plural(s.total, 'файл', 'файла', 'файлов')}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={visible}
                aria-label={visible ? `Подтема ${s.code}: ученики видят — скрыть` : `Подтема ${s.code}: скрыта — показать`}
                data-testid="training-editor-toggle"
                disabled={saving === s.code}
                onClick={() => { void toggle(s.code, visible) }}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:opacity-60',
                  visible
                    ? 'border-primary-200 bg-primary-50 text-primary-700 hover:border-primary-400'
                    : 'border-graphite-300 bg-graphite-100 text-graphite-600 hover:border-graphite-400',
                )}
              >
                <span aria-hidden className={cn('h-2 w-2 rounded-full', visible ? 'bg-primary-500' : 'bg-graphite-400')} />
                {visible ? 'видят' : 'скрыта'}
                {saving === s.code && <Loader2 size={12} className="animate-spin" />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
