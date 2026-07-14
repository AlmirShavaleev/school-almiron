import { Link } from 'react-router-dom'
import { AlertCircle, BookOpen, Loader2 } from 'lucide-react'
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
}

export function StudentNumberStatsSection({
  rows,
  loading,
  error,
  title = 'Статистика по номерам',
}: StudentNumberStatsSectionProps) {
  const recommendations = rows
    .map(row => ({ row, recommendation: getNumberRecommendation(row) }))
    .filter((entry): entry is { row: StudentNumberStatRow; recommendation: NonNullable<ReturnType<typeof getNumberRecommendation>> } => !!entry.recommendation)
    .sort((a, b) => {
      const weight = { repeat: 0, support: 1, strong: 2 } as const
      return weight[a.recommendation.kind] - weight[b.recommendation.kind]
    })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen size={18} className="text-primary-500" />
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
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

      {!loading && !error && recommendations.length > 0 && (
        <div className="mb-5 space-y-2">
          <div className="text-sm font-medium text-gray-900">Рекомендуем</div>
          {recommendations.slice(0, 4).map(({ row, recommendation }) => (
            <div key={`${recommendation.kind}-${row.section_id}`} className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{recommendation.title}</div>
                <div className="text-xs text-gray-500 mt-1">{recommendation.description}</div>
              </div>
              <Link
                to={`/catalog/${row.section_id}`}
                className="shrink-0 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Открыть
              </Link>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">№</th>
                <th className="py-2 pr-4 font-medium">Раздел</th>
                <th className="py-2 pr-4 font-medium">Верных</th>
                <th className="py-2 pr-4 font-medium">Решено</th>
                <th className="py-2 pr-4 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const light = getNumberTrafficLight(row)
                return (
                  <tr key={row.section_id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4 font-semibold text-gray-900">
                      {row.exam_number !== null ? `№${row.exam_number}` : '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <Link to={`/catalog/${row.section_id}`} className="text-gray-700 hover:text-primary-700 hover:underline">
                        {row.section_title}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-gray-700">{formatRatio(row.success_ratio)}</td>
                    <td className="py-3 pr-4 text-gray-700">{row.solved_count}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${LIGHT_STYLES[light]}`}>
                        {LIGHT_LABELS[light]}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.some(row => row.exam_number === null) && (
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>В статистике остались строки без номера только если они уже привязаны к разделу; новые неразмеченные задачи в агрегат не попадают.</span>
        </div>
      )}
    </div>
  )
}
