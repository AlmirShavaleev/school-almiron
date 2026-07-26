import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useMyHomeworkAssignments } from '@/hooks/useMyHomeworkAssignments'
import { useHomeworkAssignmentStatsV2, type HomeworkAssignmentStats } from '@/hooks/useHomeworkAssignmentStatsV2'
import { formatDate } from '@/utils/format'

const STAT_LABELS: { key: keyof HomeworkAssignmentStats; label: string }[] = [
  { key: 'assigned', label: 'Назначено' },
  { key: 'viewed', label: 'Открыли' },
  { key: 'not_started', label: 'Не приступили' },
  { key: 'submitted', label: 'Сдали' },
  { key: 'under_review', label: 'На проверке' },
  { key: 'returned_for_revision', label: 'На доработке' },
  { key: 'accepted', label: 'Принято' },
  { key: 'rejected', label: 'Отклонено' },
  { key: 'overdue', label: 'Просрочено' },
  { key: 'excused', label: 'Освобождено' },
]

export function GroupHomeworkV2Assignments({ groupId }: { groupId: string }) {
  const { rows, loading } = useMyHomeworkAssignments({ groupId })

  const assignments = useMemo(() => {
    const byId = new Map<string, { assignment_id: string; template_title: string; due_at: string }>()
    for (const r of rows) {
      if (!byId.has(r.assignment_id)) {
        byId.set(r.assignment_id, { assignment_id: r.assignment_id, template_title: r.template_title, due_at: r.due_at })
      }
    }
    return [...byId.values()]
  }, [rows])

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm py-4"><Loader2 size={16} className="animate-spin" />Загрузка назначений…</div>
  if (assignments.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-graphite-950">Назначения ДЗ v2</h2>
      {assignments.map(a => (
        <AssignmentStatsCard key={a.assignment_id} assignmentId={a.assignment_id} title={a.template_title} dueAt={a.due_at} />
      ))}
    </div>
  )
}

function AssignmentStatsCard({ assignmentId, title, dueAt }: { assignmentId: string; title: string; dueAt: string }) {
  const { stats, loading } = useHomeworkAssignmentStatsV2(assignmentId)
  const denominator = stats ? stats.assigned - stats.excused : 0

  return (
    <div className="p-4 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-400">до {formatDate(dueAt)}</span>
      </div>
      {loading || !stats ? (
        <div className="text-xs text-gray-400">Загрузка статистики…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          {STAT_LABELS.map(({ key, label }) => (
            <div key={key} className="bg-gray-50 rounded-lg px-2 py-1.5">
              <div className="text-gray-400">{label}</div>
              <div className="font-bold text-gray-800">{stats[key]}</div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-5 text-[11px] text-gray-400 pt-1">
            Знаменатель выполнения без освобождённых: {denominator}
          </div>
        </div>
      )}
    </div>
  )
}
