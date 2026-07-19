import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Filter } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useTeacherSubmissions } from '@/hooks/useAssignments'
import { SUBMISSION_STATUS_LABELS } from '@/types/assignments'
import type { SubmissionStatus } from '@/types/assignments'
import type { ReviewQueueItem } from '@/lib/reviewQueue'

const STATUS_STYLES: Record<SubmissionStatus, string> = {
  submitted: 'bg-blue-50 text-blue-700',
  returned:  'bg-amber-50 text-amber-700',
  accepted:  'bg-green-50 text-green-700',
  rejected:  'bg-red-50 text-red-700',
}

function isSubmissionStatus(status: string): status is SubmissionStatus {
  return status === 'submitted' || status === 'returned' || status === 'accepted' || status === 'rejected'
}

function hasRenderableSubmissionStatus(item: ReviewQueueItem): item is ReviewQueueItem & { status: SubmissionStatus } {
  return isSubmissionStatus(item.status)
}

export function ReviewSubmissionsPage() {
  const { submissions, loading, error } = useTeacherSubmissions()
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | 'all'>('all')

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return submissions
    return submissions.filter(s => s.status === statusFilter)
  }, [submissions, statusFilter])
  const filteredSubmissions = useMemo(() => filtered.filter(hasRenderableSubmissionStatus), [filtered])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck size={22} /> Проверка работ
        </h1>
        <p className="text-sm text-gray-500 mt-1">Сдачи учеников по вашим назначениям</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        {(['all', 'submitted', 'returned', 'accepted', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? 'Все' : SUBMISSION_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => <div key={n} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>Нет сдач</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSubmissions.map(s => (
            <Link key={s.submissionId} to={`/review-submissions/${s.submissionId}`} data-testid="submission-row">
              <Card className="hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">Сдача #{String(s.submissionId).slice(0, 8)}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Отправлено {s.submittedAt ? new Date(s.submittedAt).toLocaleString('ru-RU') : '—'}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[s.status]}`}>
                    {SUBMISSION_STATUS_LABELS[s.status]}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
