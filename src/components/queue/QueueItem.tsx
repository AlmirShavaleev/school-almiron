import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, RotateCcw, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { QueueItem as QItem } from '@/hooks/useHomeworkQueue'

const BUCKET_STYLE: Record<string, { ring: string; chip: string; label: string; icon: ReactNode }> = {
  urgent:   { ring: 'border-l-red-500',    chip: 'bg-red-100 text-red-700',       label: 'Срочно',      icon: <AlertTriangle size={11} /> },
  revision: { ring: 'border-l-yellow-500', chip: 'bg-yellow-100 text-yellow-700', label: 'Доработка',   icon: <RotateCcw size={11} /> },
  new:      { ring: 'border-l-blue-500',   chip: 'bg-blue-100 text-blue-700',     label: 'Новое',       icon: <Clock size={11} /> },
  backlog:  { ring: 'border-l-gray-300',   chip: 'bg-gray-100 text-gray-500',     label: 'Бэклог',      icon: <Clock size={11} /> },
}

function fmtDue(iso: string | null, overdue: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const s = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return overdue ? `просрочено · ${s}` : `до ${s}`
}

export function QueueItem({ item }: { item: QItem }) {
  const navigate = useNavigate()
  const st = BUCKET_STYLE[item.bucket]

  return (
    <button
      onClick={() => navigate(`/homeworks/${item.homework.id}/review/${item.group.id}/${item.student.id}`)}
      className={cn(
        'w-full flex items-center gap-3 text-left bg-white border border-gray-200 border-l-4 rounded-xl px-4 py-3 hover:shadow-sm hover:border-gray-300 transition-all',
        st.ring
      )}
    >
      {/* avatar */}
      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold shrink-0">
        {item.student.name.charAt(0)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">{item.student.name}</span>
          <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', st.chip)}>
            {st.icon}{st.label}
          </span>
        </div>
        <div className="text-xs text-gray-500 truncate mt-0.5">
          {item.homework.title}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
          <span className="truncate">{item.group.name}</span>
          {item.dueDate && (
            <>
              <span>·</span>
              <span className={cn(item.overdue && 'text-red-500 font-medium')}>{fmtDue(item.dueDate, item.overdue)}</span>
            </>
          )}
        </div>
      </div>

      <ChevronRight size={16} className="text-gray-300 shrink-0" />
    </button>
  )
}
