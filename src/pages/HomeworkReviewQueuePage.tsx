import { CheckCircle2, Inbox, Loader2, Paperclip, RefreshCw } from 'lucide-react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'
import { groupByCourse, type QueueRow } from '@/lib/homeworkQueue'
import { TOPIC_HOMEWORK_ATTEMPTS_BUCKET, type TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}

function QueueCard({
  row, files, studentName, onReview,
}: {
  row: QueueRow
  files: TopicHomeworkAttemptFileRow[]
  studentName: string
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => Promise<void>
}) {
  const { attempt } = row
  return (
    <li data-testid="queue-attempt-card" data-attempt-id={attempt.id} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">{studentName}</span>
        <span className="text-xs text-gray-400">
          Попытка №{attempt.attempt_number}
          {formatDate(attempt.submitted_at) && ` · сдано ${formatDate(attempt.submitted_at)}`}
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        {row.topicTitle} · {row.homeworkTitle}
      </p>

      <div className="mt-2">
        {files.length === 0 ? (
          <p className="text-xs text-gray-400">Файлов нет</p>
        ) : (
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
        )}
      </div>

      <ReviewActions attempt={attempt} gradeScale={row.gradeScale} onReview={onReview} />
    </li>
  )
}

/**
 * Общая очередь проверки PDF-ДЗ: все сданные работы по всем темам и курсам
 * преподавателя в одном месте, старые сверху. Вердикт ставится прямо здесь —
 * тем же RPC, что и проверка внутри темы.
 */
export function HomeworkReviewQueuePage() {
  const { rows, attemptFiles, studentNames, loading, error, reload, reviewAttempt } = useHomeworkReviewQueue()
  const filesOf = (attemptId: string) => attemptFiles.filter(f => f.attempt_id === attemptId)
  const groups = groupByCourse(rows)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Проверка домашних заданий</h1>
          <p data-testid="queue-count" className="mt-0.5 text-sm text-gray-500">
            {loading ? 'Загрузка…' : rows.length === 0 ? 'Всё проверено' : `Ждут проверки: ${rows.length}`}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Собираем сданные работы…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-14 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-gray-700">Очередь пуста</p>
          <p className="mt-1 text-xs text-gray-400">Новые сдачи учеников появятся здесь автоматически</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(g => (
            <section key={g.courseId}>
              <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <Inbox size={13} />
                {g.courseTitle}
                <span>· {g.rows.length}</span>
              </h2>
              <ul className="space-y-3">
                {g.rows.map(row => (
                  <QueueCard
                    key={row.attempt.id}
                    row={row}
                    files={filesOf(row.attempt.id)}
                    studentName={studentNames[row.attempt.student_id] ?? 'Ученик'}
                    onReview={reviewAttempt}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
