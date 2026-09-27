import { useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { bucketForMaterialPath } from '@/lib/topicMaterialItems'
import { plural } from '@/lib/plural'
import {
  TRAINING_NOTE,
  TRAINING_PLACE_LABELS,
  type TrainingItem,
  type TrainingPlace,
  type TrainingSubtopic,
} from '@/lib/training'
import { cn } from '@/utils/cn'

/** Жёлтая пометка «Тренировка» — одна на вкладку, заголовок и пояснение. */
export function TrainingMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="training-mark"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-semibold text-gold-800',
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-400" />
      Тренировка
    </span>
  )
}

/** Синяя пометка «Формат ЕГЭ» — у «Урока» в темах, где есть тренировка. */
export function EgeFormatMark({ className }: { className?: string }) {
  return (
    <span
      data-testid="ege-format-mark"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700',
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-sm bg-primary-500" />
      Формат ЕГЭ
    </span>
  )
}

/** Номер подтемы — жёлтой плашкой, как в макете. */
export function SubtopicCode({ code }: { code: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-lg bg-gold-50 px-2 py-0.5 text-sm font-bold tabular-nums text-gold-800">
      {code}
    </span>
  )
}

function pluralMaterials(n: number): string {
  return `${n} ${plural(n, 'материал', 'материала', 'материалов')}`
}

/**
 * Файл подтемы — кнопкой-«таблеткой». Открывает PDF по подписанной ссылке,
 * как плитка материала темы, и так же засчитывает просмотр (§107): ученику —
 * да, персоналу и предпросмотру — нет.
 */
function TrainingFile({ item, topicId, countView }: { item: TrainingItem; topicId: string; countView: boolean }) {
  function recordView() {
    if (!countView) return
    void supabase.rpc('record_material_view', { p_item_id: item.id } as never)
      .then(() => undefined, () => undefined)
  }
  return (
    <SignedFileLink
      bucket={bucketForMaterialPath(item.storagePath, topicId)}
      url={item.storagePath}
      onClick={recordView}
      title={item.fileName ?? item.label}
      className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border border-graphite-300 bg-white px-3 py-1.5 text-sm font-semibold text-graphite-900 transition-colors hover:border-primary-400 hover:text-primary-700"
    >
      <FileText size={14} className="shrink-0 text-graphite-400" aria-hidden />
      <span className="min-w-0 truncate">{item.label}</span>
    </SignedFileLink>
  )
}

function PlaceRow({ place, items, topicId, countView }: {
  place: TrainingPlace; items: TrainingItem[]; topicId: string; countView: boolean
}) {
  if (items.length === 0) return null
  return (
    <div data-testid={`training-place-${place}`} className="min-w-0">
      <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-graphite-500">
        {TRAINING_PLACE_LABELS[place]}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(item => <TrainingFile key={item.id} item={item} topicId={topicId} countView={countView} />)}
      </div>
    </div>
  )
}

/**
 * Вкладка «Тренировка» у ученика (§234): пояснение и подтемы аккордеоном в
 * порядке кодификатора. У подтемы две строки — «На уроке» (теория, задачи,
 * рабочий лист, решения) и «Дома» (ДЗ: задачи, рабочий лист, решения).
 *
 * Тренировочное ДЗ — самопроверка: сдавать некуда, решения лежат рядом и
 * открыты сразу (решение владельца). Отметок «сделано» здесь нет намеренно:
 * тренировка в «тема пройдена» не входит.
 */
export function TopicTrainingStudent({ topicId, subtopics, countView }: {
  topicId: string
  subtopics: TrainingSubtopic[]
  countView: boolean
}) {
  // Первая подтема раскрыта сразу: с неё и начинают, а пустой столбец
  // заголовков на первом экране выглядит как «тут ничего нет».
  const [open, setOpen] = useState<Set<string>>(() => new Set(subtopics[0] ? [subtopics[0].code] : []))
  const [first, ...rest] = TRAINING_NOTE.split('. ')

  function toggle(code: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  return (
    <div data-testid="topic-training" className="space-y-3">
      <div className="flex flex-col gap-2 rounded-card border border-gold-200 bg-gold-50/60 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
        <TrainingMark className="self-start" />
        <p className="text-sm leading-relaxed text-graphite-700">
          <strong className="font-semibold text-graphite-900">{first}.</strong>{' '}
          {rest.join('. ')}.
        </p>
      </div>

      {subtopics.map(s => {
        const isOpen = open.has(s.code)
        return (
          <section
            key={s.code}
            data-testid="training-subtopic"
            data-code={s.code}
            className={cn(
              'rounded-card border bg-white transition-colors',
              isOpen ? 'border-primary-200 shadow-card' : 'border-graphite-200',
            )}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(s.code)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <SubtopicCode code={s.code} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-semibold leading-snug text-graphite-900">
                  {s.title || `Подтема ${s.code}`}
                </span>
                {/* На телефоне счёт — под названием: справа ему места нет,
                    название и так переносится на две-три строки. */}
                <span className="mt-0.5 block text-[13px] text-graphite-500 sm:hidden">{pluralMaterials(s.total)}</span>
              </span>
              <span className="hidden shrink-0 text-xs text-graphite-500 sm:inline">{pluralMaterials(s.total)}</span>
              <ChevronDown
                size={16}
                aria-hidden
                className={cn('shrink-0 text-graphite-400 transition-transform', isOpen && 'rotate-180')}
              />
            </button>
            {isOpen && (
              <div className="grid gap-4 border-t border-graphite-200 px-4 py-3 sm:grid-cols-2">
                <PlaceRow place="lesson" items={s.lesson} topicId={topicId} countView={countView} />
                <PlaceRow place="home" items={s.home} topicId={topicId} countView={countView} />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
