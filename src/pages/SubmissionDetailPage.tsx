import { useState, useMemo, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, RotateCcw, Paperclip, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useSubmissionDetail, useGradeSubmission, useAssignmentRoster, getSubmissionFileSignedUrl } from '@/hooks/useAssignments'
import { useCatalogTasksBatch } from '@/hooks/useCatalog'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { SUBMISSION_STATUS_LABELS } from '@/types/assignments'
import type { DisplaySubmissionStatus } from '@/types/assignments'

const ROSTER_STATUS_STYLES: Record<DisplaySubmissionStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  submitted:   'bg-blue-50 text-blue-700',
  returned:    'bg-amber-50 text-amber-700',
  accepted:    'bg-green-50 text-green-700',
  rejected:    'bg-red-50 text-red-700',
}

export function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, error, reload } = useSubmissionDetail(id)
  const { grade, loading: grading, error: gradeError } = useGradeSubmission()

  const taskIds = useMemo(() => (data?.items ?? []).map(i => i.catalog_task_id), [data])
  const { tasks, loading: tasksLoading } = useCatalogTasksBatch(taskIds)
  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])

  const [score,   setScore]   = useState('')
  const [comment, setComment] = useState('')
  const [done,    setDone]    = useState(false)
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})

  const { roster } = useAssignmentRoster(data?.assignment.id)
  const isGroupAssignment = !!data?.assignment.group_id

  useEffect(() => {
    if (!data?.submission.files.length) return
    let cancelled = false
    Promise.all(data.submission.files.map(async p => [p, await getSubmissionFileSignedUrl(p)] as const))
      .then(entries => { if (!cancelled) setFileUrls(Object.fromEntries(entries.filter(([, u]) => u) as [string, string][])) })
    return () => { cancelled = true }
  }, [data?.submission.files])

  useEffect(() => {
    if (data?.submission) {
      setScore(data.submission.score !== null ? String(data.submission.score) : '')
      setComment(data.submission.teacher_comment ?? '')
    }
  }, [data?.submission])

  if (loading) return <PageSkeleton />
  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-3">
        <p className="text-red-600">{error ?? 'Сдача не найдена'}</p>
        <Link to="/review-submissions" className="text-blue-600 hover:underline text-sm">Назад к проверке</Link>
      </div>
    )
  }

  const { submission, collection, items } = data

  async function handleGrade(status: 'accepted' | 'rejected' | 'returned') {
    if (!id) return
    setDone(false)
    const ok = await grade(id, status, score ? Number(score) : null, comment || null)
    if (ok) { setDone(true); reload() }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <Link to="/review-submissions" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={14} /> Проверка работ
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">{collection.title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {collection.subject} · Отправлено {new Date(submission.submitted_at).toLocaleString('ru-RU')}
          · {SUBMISSION_STATUS_LABELS[submission.status]}
        </p>
      </div>

      {tasksLoading ? (
        <div className="space-y-3">
          {items.map(i => <div key={i.id} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => {
            const task = taskMap.get(item.catalog_task_id)
            if (!task) return null
            const answer = submission.answers?.[item.catalog_task_id]
            return (
              <div key={item.id} className="space-y-2">
                <TaskDisplayCard task={task} number={idx + 1} />
                <div className="pl-2 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 mb-1">Ответ ученика</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer || '—'}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {submission.files.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-gray-700 mb-2">Прикреплённые файлы</p>
          <div className="space-y-2">
            {submission.files.map(path => (
              fileUrls[path] ? (
                <a key={path} href={fileUrls[path]} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                  <Paperclip size={13} /> {path.split('/').pop()}
                </a>
              ) : (
                <span key={path} className="flex items-center gap-1.5 text-sm text-gray-400">
                  <Paperclip size={13} /> {path.split('/').pop()}
                </span>
              )
            ))}
          </div>
        </Card>
      )}

      {isGroupAssignment && roster.length > 0 && (
        <Card>
          <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
            <Users size={14} /> Статус по группе
          </p>
          <div className="space-y-1">
            {roster.map(r => (
              <div key={r.student_id} className="flex items-center justify-between gap-2 text-sm py-1">
                <span className="text-gray-700 truncate">{r.full_name}</span>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${ROSTER_STATUS_STYLES[r.status]}`}>
                  {SUBMISSION_STATUS_LABELS[r.status]}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <p className="text-sm font-semibold text-gray-900 mb-3">Проверка</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Оценка (необязательно)</label>
            <input
              type="number"
              value={score}
              onChange={e => setScore(e.target.value)}
              className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Комментарий</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="Комментарий для ученика…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {gradeError && <p className="text-sm text-red-600">{gradeError}</p>}
          {done && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              <CheckCircle2 size={16} /> Статус обновлён
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button variant="success" onClick={() => handleGrade('accepted')} loading={grading}>
              <CheckCircle2 size={15} /> Принять
            </Button>
            <Button variant="secondary" onClick={() => handleGrade('returned')} loading={grading}>
              <RotateCcw size={15} /> Вернуть на доработку
            </Button>
            <Button variant="danger" onClick={() => handleGrade('rejected')} loading={grading}>
              <XCircle size={15} /> Отклонить
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="h-8 bg-gray-200 rounded w-64" />
      {[1, 2, 3].map(n => <div key={n} className="h-24 bg-gray-100 rounded-xl" />)}
    </div>
  )
}
