import { useState } from 'react'
import { Check, Loader2, Star } from 'lucide-react'
import { useTopicRating } from '@/hooks/useTopicRating'
import { TOPIC_RATING_MAX, TOPIC_RATING_PREVIEW_NOTE, TOPIC_RATING_VALUES } from '@/lib/topicRatings'
import { cn } from '@/utils/cn'

/**
 * §271. «Оцените урок» — внизу каждой страницы темы у ученика, при любом
 * формате урока. 10 звёзд, клик ставит оценку 1..10; поменять можно в любой
 * момент (upsert на сервере). Текста нет — решение владельца: нужен быстрый
 * сигнал «урок непонятен», а не отзыв.
 *
 * Ширина: 10 кнопок по 24 px с зазором 2 px — 258 px, влезают в 320 px с
 * отступами страницы и карточки; если всё же тесно — ряд переносится, а не
 * уезжает за край.
 *
 * В предпросмотре (§178) блок виден, но выключен: ставить оценку не за кого.
 */
export function TopicRatingBlock({ topicId, preview }: { topicId: string; preview: boolean }) {
  const { rating, loading, saving, saved, error, rate } = useTopicRating(topicId, { preview })
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? rating ?? 0
  const disabled = preview || saving || loading

  return (
    <section
      data-testid="topic-rating"
      aria-labelledby="topic-rating-title"
      className="rounded-2xl border border-gray-200 bg-white px-3 py-4 sm:px-5"
    >
      <h2 id="topic-rating-title" className="text-base font-semibold text-gray-900">Оцените урок</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Насколько понятным был урок: 1 — совсем непонятно, {TOPIC_RATING_MAX} — всё ясно.
      </p>

      <div
        role="group"
        aria-label="Оценка урока"
        className="mt-3 flex flex-wrap items-center gap-0.5 sm:gap-1"
        onMouseLeave={() => setHover(null)}
      >
        {TOPIC_RATING_VALUES.map(n => {
          const filled = n <= shown
          return (
            <button
              key={n}
              type="button"
              data-testid={`topic-rating-star-${n}`}
              aria-label={`Оценка ${n} из ${TOPIC_RATING_MAX}`}
              aria-pressed={rating === n}
              title={preview ? TOPIC_RATING_PREVIEW_NOTE : `${n} из ${TOPIC_RATING_MAX}`}
              disabled={disabled}
              onClick={() => rate(n)}
              onMouseEnter={() => !disabled && setHover(n)}
              onFocus={() => !disabled && setHover(n)}
              onBlur={() => setHover(null)}
              className={cn(
                'flex h-7 w-6 shrink-0 items-center justify-center rounded transition-transform sm:h-8 sm:w-8',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                !disabled && 'hover:scale-110',
                preview && 'cursor-not-allowed opacity-50',
              )}
            >
              <Star
                aria-hidden
                className={cn(
                  'h-[22px] w-[22px] sm:h-6 sm:w-6',
                  filled ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-gray-300',
                )}
              />
            </button>
          )
        })}
        {saving && <Loader2 size={16} aria-hidden className="ml-1 animate-spin text-gray-400" />}
      </div>

      <div aria-live="polite" className="mt-2 min-h-[1.25rem] text-xs">
        {preview ? (
          <span data-testid="topic-rating-preview" className="text-gray-500">{TOPIC_RATING_PREVIEW_NOTE}</span>
        ) : error ? (
          <span data-testid="topic-rating-error" className="text-red-600">{error}</span>
        ) : saved ? (
          <span data-testid="topic-rating-saved" className="inline-flex items-center gap-1 font-medium text-emerald-700">
            <Check size={13} aria-hidden />Спасибо! Ваша оценка: {rating} из {TOPIC_RATING_MAX}
          </span>
        ) : rating != null ? (
          <span data-testid="topic-rating-current" className="text-gray-600">
            Ваша оценка: {rating} из {TOPIC_RATING_MAX}. Можно изменить в любой момент.
          </span>
        ) : null}
      </div>
    </section>
  )
}
