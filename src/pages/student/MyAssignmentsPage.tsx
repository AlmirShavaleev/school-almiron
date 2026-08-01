import { Link } from 'react-router-dom'
import { ClipboardList, CalendarClock } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useStudentAssignments } from '@/hooks/useAssignments'
import { SUBMISSION_STATUS_LABELS } from '@/types/assignments'
import type { DisplaySubmissionStatus } from '@/types/assignments'

const STATUS_STYLES: Record<DisplaySubmissionStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  submitted:   'bg-blue-50 text-blue-700',
  returned:    'bg-amber-50 text-amber-700',
  accepted:    'bg-green-50 text-green-700',
  rejected:    'bg-red-50 text-red-700',
}

export function MyAssignmentsPage() {
  const { assignments, ownSubmissions, loading, error } = useStudentAssignments()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList size={22} /> Мои задания
        </h1>
        <p className="text-sm text-gray-500 mt-1">Работы, назначенные вам учителем</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => <div key={n} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : assignments.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>Пока нет назначенных заданий</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            // Per-student progress (own submission), NOT the assignment's own lifecycle status
            const status: DisplaySubmissionStatus = ownSubmissions.get(a.id)?.status ?? 'not_started'
            return (
              <Link key={a.id} to={`/my-assignments/${a.id}`} data-testid="assignment-card">
                <Card className="hover:border-blue-200 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">Задание #{a.id.slice(0, 8)}</p>
                      {a.due_date && (
                        <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                          <CalendarClock size={12} /> Срок: {new Date(a.due_date).toLocaleDateString('ru-RU')}
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}>
                      {SUBMISSION_STATUS_LABELS[status]}
                    </span>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
