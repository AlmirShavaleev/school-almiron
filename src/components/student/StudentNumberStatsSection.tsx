import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Loader2, Sparkles, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { StudentNumberStatRow } from '@/utils/studentNumberStats'
import { formatRatio, getNumberRecommendation, getNumberTrafficLight } from '@/utils/studentNumberStats'

const LIGHT_STYLES = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  gray: 'bg-gray-100 text-gray-500',
} as const

const LIGHT_LABELS = {
  green: 'Сильный',
  yellow: 'Нужно закрепить',
  red: 'Повторить',
  gray: 'Мало данных',
} as const

interface StudentNumberStatsSectionProps {
  rows: StudentNumberStatRow[]
  loading: boolean
  error: string | null
  title?: string
  compact?: boolean
}

export function StudentNumberStatsSection({
  rows,
  loading,
  error,
  title = 'Статистика по номерам',
  compact = false,
}: StudentNumberStatsSectionProps) {
  const recommendations = rows
    .map(row => ({ row, recommendation: getNumberRecommendation(row) }))
    .filter((entry): entry is { row: StudentNumberStatRow; recommendation: NonNullable<ReturnType<typeof getNumberRecommendation>> } => !!entry.recommendation)
    .sort((a, b) => {
      const weight = { repeat: 0, support: 1, strong: 2 } as const
      return weight[a.recommendation.kind] - weight[b.recommendation.kind]
    })
  const bestRow = [...rows].sort((a, b) => (b.success_ratio ?? 0) - (a.success_ratio ?? 0))[0] ?? null
  const weakRow = [...rows].sort((a, b) => (a.success_ratio ?? 0) - (b.success_ratio ?? 0))[0] ?? null
  const solvedTotal = rows.reduce((sum, row) => sum + row.solved_count, 0)
  const avgRatio = rows.length > 0
    ? rows.reduce((sum, row) => sum + (row.success_ratio ?? 0), 0) / rows.length
    : null

  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-[28px] border border-sky-100 bg-gradient-to-br from-white via-sky-50/70 to-indigo-50/60 p-6 shadow-[0_22px_70px_-40px_rgba(37,99,235,0.45)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-400" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <div className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm ring-1 ring-sky-100">
              <Sparkles size={14} />
              Аналитика 1 части
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{title}</h2>
            <p className="mt-2 max-w-[62ch] text-sm leading-6 text-slate-600">
              Смотрим, какие номера первой части уже стабильно получаются, а какие пока чаще дают ошибки.
            </p>
          </div>

          <Link
            to="/student/variants/stats"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition-transform transition-colors hover:scale-[0.98] hover:bg-slate-900"
          >
            № и статистика по всем номерам
            <ArrowRight size={15} />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[22px] bg-white/80 px-4 py-4 ring-1 ring-black/5 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Номеров в анализе</div>
            <div className="mt-2 text-3xl font-bold text-slate-950 tabular-nums">{rows.length}</div>
            <div className="mt-1 text-sm text-slate-500">Всего попыток: {solvedTotal}</div>
          </div>
          <div className="rounded-[22px] bg-white/80 px-4 py-4 ring-1 ring-black/5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
              <TrendingUp size={14} className="text-emerald-500" />
              Лучший номер
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-950">
              {bestRow && bestRow.exam_number !== null ? `№${bestRow.exam_number}` : 'Пока нет'}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {bestRow ? `${formatRatio(bestRow.success_ratio)} при ${bestRow.solved_count} решениях` : 'Недостаточно данных'}
            </div>
          </div>
          <div className="rounded-[22px] bg-white/80 px-4 py-4 ring-1 ring-black/5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
              <TrendingDown size={14} className="text-rose-500" />
              Нужен фокус
            </div>
            <div className="mt-2 text-lg font-semibold text-slate-950">
              {weakRow && weakRow.exam_number !== null ? `№${weakRow.exam_number}` : 'Пока нет'}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {weakRow ? `${formatRatio(weakRow.success_ratio)} при ${weakRow.solved_count} решениях` : 'Недостаточно данных'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.45)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-400" />

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-100 shadow-sm">
            <BookOpen size={14} />
            Аналитика решения задач 1 части
          </div>
          <h2 className="mt-4 text-[28px] font-bold tracking-tight text-slate-950">{title}</h2>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-slate-600">
            Здесь видно, какие номера первой части уже стабильны, где падает точность и что лучше повторить следующим блоком.
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-[22px] bg-white/90 px-4 py-4 ring-1 ring-black/5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Номеров</div>
          <div className="mt-2 text-3xl font-bold text-slate-950 tabular-nums">{rows.length}</div>
        </div>
        <div className="rounded-[22px] bg-white/90 px-4 py-4 ring-1 ring-black/5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Попыток</div>
          <div className="mt-2 text-3xl font-bold text-slate-950 tabular-nums">{solvedTotal}</div>
        </div>
        <div className="rounded-[22px] bg-white/90 px-4 py-4 ring-1 ring-black/5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Средняя точность</div>
          <div className="mt-2 text-3xl font-bold text-slate-950 tabular-nums">{formatRatio(avgRatio)}</div>
        </div>
        <div className="rounded-[22px] bg-white/90 px-4 py-4 ring-1 ring-black/5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            <Target size={14} className="text-violet-500" />
            Фокус сейчас
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-950">
            {weakRow && weakRow.exam_number !== null ? `№${weakRow.exam_number}` : 'Недостаточно данных'}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {weakRow ? `${formatRatio(weakRow.success_ratio)} при ${weakRow.solved_count} решениях` : 'Добавьте ещё попытки'}
          </div>
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center text-gray-500">
          <Loader2 size={20} className="animate-spin mx-auto mb-2 text-primary-500" />
          Загружаем статистику…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
          Пока недостаточно данных по решённым заданиям для статистики по номерам.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-hidden rounded-[26px] bg-white/85 ring-1 ring-black/5 shadow-sm">
          <div className="grid grid-cols-[72px,minmax(0,1fr),110px,100px,126px] gap-0 border-b border-slate-100 px-5 py-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
            <div>№</div>
            <div>Номер и тема</div>
            <div>Верных</div>
            <div>Решено</div>
            <div>Статус</div>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.map(row => {
              const light = getNumberTrafficLight(row)
              return (
                <div key={row.section_id} className="grid grid-cols-[72px,minmax(0,1fr),110px,100px,126px] items-center gap-0 px-5 py-4 text-sm">
                  <div className="font-semibold text-slate-950 tabular-nums">
                    {row.exam_number !== null ? `№${row.exam_number}` : '—'}
                  </div>
                  <div className="pr-4">
                    <Link
                      to={`/catalog/${row.section_id}`}
                      className="font-medium text-slate-800 transition-colors hover:text-sky-700"
                    >
                      {row.section_title}
                    </Link>
                  </div>
                  <div className="font-semibold text-slate-700 tabular-nums">{formatRatio(row.success_ratio)}</div>
                  <div className="text-slate-600 tabular-nums">{row.solved_count}</div>
                  <div>
                    <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-medium ${LIGHT_STYLES[light]}`}>
                      {LIGHT_LABELS[light]}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && !error && recommendations.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-medium text-slate-900">Рекомендуем повторить</div>
          {recommendations.slice(0, 4).map(({ row, recommendation }) => (
            <div key={`${recommendation.kind}-${row.section_id}`} className="flex items-start justify-between gap-3 rounded-[24px] bg-white/85 px-4 py-4 ring-1 ring-black/5 shadow-sm">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-950">{recommendation.title}</div>
                <div className="text-xs text-slate-500 mt-1">{recommendation.description}</div>
              </div>
              <Link
                to={`/catalog/${row.section_id}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-950 px-3.5 py-2 text-sm font-medium text-white transition-transform transition-colors hover:scale-[0.98] hover:bg-slate-900"
              >
                Открыть
                <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
