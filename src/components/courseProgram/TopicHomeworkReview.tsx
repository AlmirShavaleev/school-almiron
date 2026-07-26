import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Paperclip, RotateCcw, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import {
  ATTEMPT_STATUS_TONE,
  TEACHER_ATTEMPT_STATUS_LABEL,
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  groupAttemptsByStudent,
  isReviewable,
  latestReview,
  type StudentSubmission,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkReviewRow,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function AttemptFiles({ files }: { files: TopicHomeworkAttemptFileRow[] }) {
  if (files.length === 0) return <p className="text-xs text-gray-400">Файлов нет</p>
  return (
    <div className="flex flex-wrap gap-2">
      {files.map(f => (
        <SignedFileLink
          key={f.id}
          bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
          url={f.storage_path}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-primary-600 hover:border-primary-300 hover:underline"
        >
          <Paperclip size={12} />
          {f.file_name}
        </SignedFileLink>
      ))}
    </div>
  )
}

// ─── Форма вердикта ───────────────────────────────────────────────────────────

function ReviewActions({
  attempt,
  onReview,
}: {
  attempt: TopicHomeworkAttemptRow
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string) => Promise<void>
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Комментарий обязателен только при возврате. То же условие держит
  // CHECK topic_homework_reviews_comment_chk — здесь оно ради подсказки,
  // а не вместо базы.
  const canReturn = comment.trim().length > 0

  async function run(decision: 'accepted' | 'returned_for_revision') {
    setBusy(true)
    setError(null)
    try {
      await onReview(attempt.id, decision, comment)
      setComment('')
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось сохранить решение')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Комментарий (обязателен при возврате на доработку)"
        aria-label="Комментарий к работе"
        rows={2}
        className="mb-2 w-full rounded-xl border border-gray-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
      />

      {error && <div className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="success" onClick={() => run('accepted')} loading={busy}>
          <Check size={14} />
          Принять
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => run('returned_for_revision')}
          disabled={busy || !canReturn}
          title={canReturn ? undefined : 'Напишите, что исправить'}
        >
          <RotateCcw size={14} />
          Вернуть на доработку
        </Button>
        {!canReturn && <span className="text-xs text-gray-400">Для возврата нужен комментарий</span>}
      </div>
    </div>
  )
}

// ─── Карточка ученика ─────────────────────────────────────────────────────────

function SubmissionCard({
  submission, studentName, attemptFiles, reviews, onReview,
}: {
  submission: StudentSubmission
  studentName: string
  attemptFiles: TopicHomeworkAttemptFileRow[]
  reviews: TopicHomeworkReviewRow[]
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { latest, history } = submission
  const filesOf = (id: string) => attemptFiles.filter(f => f.attempt_id === id)

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">{studentName}</span>
        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[latest.status])}>
          {TEACHER_ATTEMPT_STATUS_LABEL[latest.status]}
        </span>
        <span className="text-xs text-gray-400">
          Попытка №{latest.attempt_number}
          {formatDate(latest.submitted_at) && ` · ${formatDate(latest.submitted_at)}`}
        </span>
      </div>

      <div className="mt-2">
        <AttemptFiles files={filesOf(latest.id)} />
      </div>

      {latestReview(reviews, latest.id)?.comment && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          {latestReview(reviews, latest.id)!.comment}
        </p>
      )}

      {isReviewable(latest) && <ReviewActions attempt={latest} onReview={onReview} />}

      {history.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Предыдущие попытки ({history.length})
          </button>

          {open && (
            <ul className="mt-2 space-y-2">
              {history.map(a => {
                const review = latestReview(reviews, a.id)
                return (
                  <li key={a.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">Попытка №{a.attempt_number}</span>
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', ATTEMPT_STATUS_TONE[a.status])}>
                        {TEACHER_ATTEMPT_STATUS_LABEL[a.status]}
                      </span>
                      {formatDate(a.submitted_at) && (
                        <span className="text-[11px] text-gray-400">{formatDate(a.submitted_at)}</span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <AttemptFiles files={filesOf(a.id)} />
                    </div>
                    {review?.comment && (
                      <p className="mt-1.5 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">
                        {review.comment}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Список сдач по теме ──────────────────────────────────────────────────────

/**
 * Локальная проверка ДЗ внутри темы. Общей очереди здесь нет — она отдельно.
 *
 * Список приходит из RLS: преподаватель видит попытки только своего курса,
 * ученик этот компонент не получает вовсе — он смонтирован лишь в
 * преподавательской модалке темы. Клиент ничего дополнительно не проверяет.
 */
export function TopicHomeworkReview({
  attempts,
  attemptFiles,
  reviews,
  studentNames,
  loading,
  onReview,
  className,
}: {
  attempts: TopicHomeworkAttemptRow[]
  attemptFiles: TopicHomeworkAttemptFileRow[]
  reviews: TopicHomeworkReviewRow[]
  studentNames: Record<string, string>
  loading?: boolean
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string) => Promise<void>
  className?: string
}) {
  const submissions = groupAttemptsByStudent(attempts)

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-4 text-sm text-gray-400', className)}>
        <Loader2 size={15} className="animate-spin" />
        Загрузка работ…
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <Users size={13} />
        Работы учеников
        {submissions.length > 0 && <span>· {submissions.length}</span>}
      </div>

      {submissions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
          Работ пока нет
        </p>
      ) : (
        <ul className="space-y-3">
          {submissions.map(s => (
            <SubmissionCard
              key={s.studentId}
              submission={s}
              studentName={studentNames[s.studentId] ?? 'Ученик'}
              attemptFiles={attemptFiles}
              reviews={reviews}
              onReview={onReview}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
