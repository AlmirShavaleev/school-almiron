import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Star } from 'lucide-react'
import { useCourseProgram, type Module } from '@/hooks/useCourseProgram'
import {
  TOPIC_RATING_MAX,
  TOPIC_RATING_REWORK_BELOW,
  TOPIC_RATING_VALUES,
  buildTopicRatingRows,
  fetchTopicRatingsSummary,
  formatTopicRatingAvg,
  needsRework,
  sortTopicRatingRows,
  type TopicRatingRow,
  type TopicRatingSort,
  type TopicRatingSummary,
} from '@/lib/topicRatings'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §271. «Оценки уроков» — где ученикам непонятно.
 *
 * Ученик ставит уроку 1–10 звёзд (`TopicRatingBlock` внизу темы); здесь —
 * сводка по курсу без имён: среднее, сколько оценок, распределение и когда
 * оценили последний раз. По умолчанию сверху самые низкие — ради этого экран
 * и нужен; неоценённые уроки — внизу. Среднее ниже 7 — «переработать».
 *
 * Курсы — те же, что в «Программе курса» (`useCourseProgram`: RLS у
 * преподавателя, сужение по своим курсам у владельца в режиме учителя).
 * Сводку отдаёт `topic_ratings_summary` — только персоналу курса.
 */
export function TopicRatingsPage() {
  const { courses, loading: coursesLoading, loadModules } = useCourseProgram()
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState<TopicRatingSort>('worst')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Каркасы (шаблоны) — в конце: учеников в них не зачисляют (§113), оценок там нет.
  const orderedCourses = useMemo(
    () => [...courses].sort((a, b) => Number(a.is_template) - Number(b.is_template)),
    [courses],
  )
  const requested = params.get('course')
  const courseId = orderedCourses.some(c => c.id === requested) ? requested : orderedCourses[0]?.id ?? null

  // loadModules — новая функция на каждый рендер хука; держим последнюю в ref,
  // чтобы загрузка зависела только от выбранного курса. Эффект объявлен раньше
  // загрузки — к её запуску ref уже свежий.
  const loadModulesRef = useRef(loadModules)
  useEffect(() => { loadModulesRef.current = loadModules })

  const [data, setData] = useState<{ courseId: string; modules: Module[]; summary: TopicRatingSummary[]; error: string | null } | null>(null)

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    Promise.all([
      loadModulesRef.current(courseId).catch(() => null),
      fetchTopicRatingsSummary(courseId),
    ]).then(([modules, summary]) => {
      if (cancelled) return
      setData({
        courseId,
        modules: modules ?? [],
        summary: summary.rows,
        error: modules == null ? 'Не удалось загрузить программу курса' : summary.error,
      })
    })
    return () => { cancelled = true }
  }, [courseId])

  const loading = coursesLoading || (!!courseId && data?.courseId !== courseId)
  const current = data && data.courseId === courseId ? data : null

  const rows = useMemo(
    () => current ? sortTopicRatingRows(buildTopicRatingRows(current.modules, current.summary), sort) : [],
    [current, sort],
  )
  const rated = rows.filter(r => r.ratings > 0).length
  const rework = rows.filter(needsRework).length

  return (
    <div className="max-w-5xl space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Оценки уроков</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ученики ставят уроку от 1 до {TOPIC_RATING_MAX} звёзд внизу страницы темы. Сверху — самые непонятные:
          со средним ниже {TOPIC_RATING_REWORK_BELOW} урок стоит переработать. Имён учеников здесь нет.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 sm:w-80">
          <span className="mb-1 block text-xs font-medium text-gray-500">Курс</span>
          <select
            data-testid="topic-ratings-course"
            value={courseId ?? ''}
            disabled={coursesLoading || orderedCourses.length === 0}
            onChange={e => {
              setExpanded(null)
              setParams(prev => { const next = new URLSearchParams(prev); next.set('course', e.target.value); return next }, { replace: true })
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            {orderedCourses.map(c => (
              <option key={c.id} value={c.id}>{c.title}{c.is_template ? ' (каркас)' : ''}</option>
            ))}
          </select>
        </label>

        <div role="group" aria-label="Порядок" className="inline-flex self-start rounded-lg border border-gray-200 bg-white p-0.5 text-sm sm:self-auto">
          {([['worst', 'Сначала низкие'], ['course', 'По порядку курса']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              data-testid={`topic-ratings-sort-${key}`}
              onClick={() => setSort(key)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                sort === key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />Загрузка…
        </div>
      ) : !courseId ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          Нет курсов, к которым у вас есть доступ
        </div>
      ) : current?.error ? (
        <div data-testid="topic-ratings-error" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />{current.error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          В курсе пока нет уроков
        </div>
      ) : (
        <>
          <p data-testid="topic-ratings-stats" className="text-sm text-gray-600">
            Оценено {rated} из {rows.length} {plural(rows.length, 'урока', 'уроков', 'уроков')}
            {rework > 0 && <> · <span className="font-medium text-red-700">переработать: {rework}</span></>}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500">
                  <th className="px-4 py-2.5 text-left font-medium">Урок</th>
                  <th className="w-24 px-3 py-2.5 text-center font-medium">Средняя</th>
                  <th className="w-20 px-3 py-2.5 text-center font-medium">Оценок</th>
                  <th className="w-32 px-3 py-2.5 text-center font-medium">1 … {TOPIC_RATING_MAX}</th>
                  <th className="w-28 px-3 py-2.5 text-right font-medium">Последняя</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <RatingRow
                    key={row.topicId}
                    row={row}
                    open={expanded === row.topicId}
                    onToggle={() => setExpanded(e => e === row.topicId ? null : row.topicId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function RatingRow({ row, open, onToggle }: { row: TopicRatingRow; open: boolean; onToggle: () => void }) {
  const rework = needsRework(row)
  const hasRatings = row.ratings > 0
  const maxCount = Math.max(1, ...row.dist)
  return (
    <Fragment>
      <tr
        data-testid="topic-ratings-row"
        data-topic-id={row.topicId}
        data-rework={rework ? 'true' : undefined}
        className={cn('border-b border-gray-100 last:border-0', rework && 'bg-red-50/60')}
      >
        <td className="px-4 py-2.5">
          {hasRatings ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="group flex w-full items-start gap-1.5 text-left"
            >
              {open
                ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-gray-400" />
                : <ChevronRight size={14} className="mt-0.5 shrink-0 text-gray-400" />}
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 group-hover:text-primary-700">{row.title}</span>
                <span className="block text-xs text-gray-400">{row.moduleTitle}</span>
              </span>
            </button>
          ) : (
            <div className="pl-5">
              <span className="block font-medium text-gray-700">{row.title}</span>
              <span className="block text-xs text-gray-400">{row.moduleTitle}</span>
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-center">
          {row.avg != null ? (
            <span className="inline-flex flex-col items-center">
              <span data-testid="topic-ratings-avg" className={cn('inline-flex items-center gap-1 font-semibold', rework ? 'text-red-700' : 'text-gray-900')}>
                <Star size={12} aria-hidden className="fill-amber-400 text-amber-400" />
                {formatTopicRatingAvg(row.avg)}
              </span>
              {rework && (
                <span data-testid="topic-ratings-rework" className="mt-0.5 rounded-full bg-red-100 px-1.5 py-px text-[10px] font-semibold text-red-700">
                  переработать
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-400">нет оценок</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-center tabular-nums text-gray-700">{hasRatings ? row.ratings : '—'}</td>
        <td className="px-3 py-2.5">
          {hasRatings && (
            <div className="mx-auto flex h-6 w-[100px] items-end gap-px" aria-label={`Распределение: ${row.dist.map((c, i) => `${i + 1} — ${c}`).join(', ')}`}>
              {row.dist.map((c, i) => (
                <span
                  key={i}
                  className={cn('flex-1 rounded-sm', i + 1 < TOPIC_RATING_REWORK_BELOW ? 'bg-red-300' : 'bg-emerald-400', c === 0 && 'bg-gray-100')}
                  style={{ height: c === 0 ? 2 : `${Math.max(12, (c / maxCount) * 100)}%` }}
                />
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-right text-xs text-gray-500">{row.lastAt ? formatDay(row.lastAt) : '—'}</td>
      </tr>
      {open && hasRatings && (
        <tr data-testid="topic-ratings-dist" className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={5} className="px-4 py-3">
            <ul className="grid gap-1 sm:max-w-md">
              {[...TOPIC_RATING_VALUES].reverse().map(n => {
                const c = row.dist[n - 1] ?? 0
                return (
                  <li key={n} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 text-gray-500">{n} {plural(n, 'звезда', 'звезды', 'звёзд')}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                      <span
                        className={cn('block h-full rounded-full', n < TOPIC_RATING_REWORK_BELOW ? 'bg-red-400' : 'bg-emerald-500')}
                        style={{ width: `${(c / row.ratings) * 100}%` }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right tabular-nums text-gray-700">{c}</span>
                  </li>
                )
              })}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
