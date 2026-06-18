import { Link } from 'react-router-dom'
import { Video, Plus } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDateTime } from '@/utils/format'
import type { GroupLesson } from '@/hooks/useGroupControl'

export function LessonStream({ lessons, canManage, onCreate }: { lessons: GroupLesson[]; canManage: boolean; onCreate: () => void }) {
  const now = new Date()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Video size={17} />Занятия</CardTitle>
        {canManage && (
          <button onClick={onCreate} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            <Plus size={13} />Создать
          </button>
        )}
      </CardHeader>
      {lessons.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Занятий ещё нет</p>
      ) : (
        <div className="space-y-0 max-h-[360px] overflow-y-auto">
          {lessons.map(l => {
            const past = new Date(l.scheduled_at) < now
            return (
              <Link key={l.id} to={`/lessons/${l.id}`}
                className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors">
                <div className={cn('w-2 h-2 rounded-full shrink-0', past ? 'bg-gray-300' : 'bg-blue-500')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{l.title}</div>
                  <div className="text-xs text-gray-400">{formatDateTime(l.scheduled_at)}</div>
                </div>
                {l.status === 'completed' ? <Badge variant="success" className="text-xs shrink-0">Завершено</Badge>
                  : l.status === 'cancelled' ? <Badge variant="default" className="text-xs shrink-0">Отменено</Badge>
                  : !past && l.zoom_link ? (
                    <a href={l.zoom_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 shrink-0">Zoom →</a>
                  ) : null}
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}
