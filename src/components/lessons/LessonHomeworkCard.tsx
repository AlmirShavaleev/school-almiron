import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardList, Plus, CalendarClock, ChevronRight, Users } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useLessonHomework, useAssignmentRoster } from '@/hooks/useAssignments'
import { SUBMISSION_STATUS_LABELS } from '@/types/assignments'
import type { DisplaySubmissionStatus } from '@/types/assignments'
import { AssignLessonHomeworkModal } from './AssignLessonHomeworkModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const STATUS_STYLES: Record<DisplaySubmissionStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  submitted:   'bg-blue-50 text-blue-700',
  returned:    'bg-amber-50 text-amber-700',
  accepted:    'bg-green-50 text-green-700',
  rejected:    'bg-red-50 text-red-700',
}

interface Props {
  lessonId:  string
  canEdit:   boolean // teacher/admin/owner who owns the lesson
  isStudent: boolean
}

export function LessonHomeworkCard({ lessonId, canEdit, isStudent }: Props) {
  const { assignments, ownSubmission, loading, reload } = useLessonHomework(lessonId)
  const [searchParams, setSearchParams] = useSearchParams()
  const preselectCollectionId = searchParams.get('assignCollection') ?? undefined
  const [showAssignModal, setShowAssignModal] = useState(!!preselectCollectionId)
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null)

  function closeModal() {
    setShowAssignModal(false)
    if (preselectCollectionId) {
      searchParams.delete('assignCollection')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const assignment = assignments[0]

  useEffect(() => {
    if (!assignment) { setCollectionTitle(null); return }
    db.from('task_collections').select('title').eq('id', assignment.collection_id).maybeSingle()
      .then(({ data }: { data: { title: string } | null }) => setCollectionTitle(data?.title ?? null))
  }, [assignment])

  const { roster } = useAssignmentRoster(canEdit ? assignment?.id : undefined)
  const isGroup = !!assignment?.group_id

  const modal = showAssignModal && (
    <AssignLessonHomeworkModal
      lessonId={lessonId}
      preselectCollectionId={preselectCollectionId}
      onClose={closeModal}
      onAssigned={reload}
    />
  )

  // The modal must never unmount while open — reload() briefly flips `loading`
  // back to true, and an early return here would tear down (and reset) it.
  if (loading) return <>
    <Card><div className="h-16 bg-gray-100 rounded-lg animate-pulse" /></Card>
    {modal}
  </>

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardList size={17} />Домашнее задание</CardTitle>
        {canEdit && !assignment && (
          <button onClick={() => setShowAssignModal(true)} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
            <Plus size={12} />Добавить домашнее задание
          </button>
        )}
      </CardHeader>

      {!assignment ? (
        <p className="text-sm text-gray-400 py-3 text-center">Домашнее задание пока не добавлено</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{collectionTitle ?? '…'}</p>
              {assignment.due_date && (
                <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                  <CalendarClock size={12} /> до {new Date(assignment.due_date).toLocaleDateString('ru-RU')}
                </p>
              )}
            </div>

            {isStudent ? (
              <StudentStatusBadge status={ownSubmission?.status ?? null} />
            ) : isGroup ? (
              <span className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-500">
                <Users size={12} /> {roster.length} учеников
              </span>
            ) : null}
          </div>

          {isStudent && (
            <Link
              to={`/my-assignments/${assignment.id}`}
              className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 hover:border-primary-300 hover:bg-primary-50 transition-colors text-sm text-gray-700"
            >
              Открыть задание <ChevronRight size={14} />
            </Link>
          )}

          {canEdit && !isGroup && (
            <RosterRow entries={roster} />
          )}

          {canEdit && isGroup && (
            <div className="space-y-1">
              <GroupSummary roster={roster} />
              <div className="max-h-48 overflow-y-auto space-y-1">
                <RosterRow entries={roster} />
              </div>
            </div>
          )}
        </div>
      )}

    </Card>
    {modal}
    </>
  )
}

function StudentStatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'not_started') as DisplaySubmissionStatus
  return (
    <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[s]}`}>
      {SUBMISSION_STATUS_LABELS[s]}
    </span>
  )
}

function GroupSummary({ roster }: { roster: { status: string }[] }) {
  const total = roster.length
  const notStarted = roster.filter(r => r.status === 'not_started').length
  const submitted  = roster.filter(r => r.status === 'submitted').length
  const returned   = roster.filter(r => r.status === 'returned').length
  const accepted   = roster.filter(r => r.status === 'accepted').length

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
      <span>Всего: <b>{total}</b></span>
      <span>Не начали: <b>{notStarted}</b></span>
      <span>Сдали: <b>{submitted}</b></span>
      <span>Возвращено: <b>{returned}</b></span>
      <span>Принято: <b>{accepted}</b></span>
    </div>
  )
}

function RosterRow({ entries }: { entries: { student_id: string; full_name: string; submission_id: string | null; status: string }[] }) {
  if (!entries.length) return null
  return (
    <>
      {entries.map(r => (
        <div key={r.student_id} className="flex items-center justify-between gap-2 text-sm py-1">
          <span className="text-gray-700 truncate">{r.full_name}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status as DisplaySubmissionStatus] ?? STATUS_STYLES.not_started}`}>
              {SUBMISSION_STATUS_LABELS[r.status as DisplaySubmissionStatus] ?? r.status}
            </span>
            {r.submission_id && (
              <Link to={`/review-submissions/${r.submission_id}`} className="text-primary-600 hover:underline text-xs">Открыть</Link>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
