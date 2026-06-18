import { useNavigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import type { PipeStatus, PipeCard } from '@/hooks/useGroupControl'

const COLUMNS: { key: PipeStatus; label: string; head: string; ring: string }[] = [
  { key: 'submitted',     label: '🔴 На проверке', head: 'text-orange-600', ring: 'border-t-orange-400' },
  { key: 'revision',      label: '🔁 Доработка',   head: 'text-yellow-600', ring: 'border-t-yellow-400' },
  { key: 'checked',       label: '🟢 Проверено',   head: 'text-green-600',  ring: 'border-t-green-400' },
  { key: 'not_submitted', label: '⚪ Не сдано',     head: 'text-gray-400',   ring: 'border-t-gray-300' },
]

export function HomeworkPipeline({ pipeline, groupId }: { pipeline: Record<PipeStatus, PipeCard[]>; groupId: string }) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {COLUMNS.map(col => {
        const cards = pipeline[col.key]
        return (
          <div key={col.key} className={cn('bg-gray-50 rounded-2xl border-t-4 p-3 flex flex-col', col.ring)}>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className={cn('text-xs font-bold', col.head)}>{col.label}</span>
              <span className="text-xs font-semibold text-gray-400">{cards.length}</span>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[360px] pr-0.5">
              {cards.length === 0 ? (
                <p className="text-xs text-gray-300 text-center py-6">пусто</p>
              ) : cards.map(c => (
                <button
                  key={c.key}
                  onClick={() => navigate(`/homeworks/${c.hwId}/review/${groupId}/${c.studentId}`)}
                  className="w-full text-left bg-white border border-gray-200 rounded-xl px-3 py-2 hover:border-primary-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {c.studentName.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">{c.studentName}</span>
                    {c.status === 'checked' && c.score != null && (
                      <span className="text-xs font-semibold text-green-600 shrink-0">{c.score}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate mt-1 pl-8">{c.hwTitle}</div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
