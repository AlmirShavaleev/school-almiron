import { useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronRight, Inbox, Loader2, Paperclip, RefreshCw,
} from 'lucide-react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'
import { groupByCourse, isSubmittedLate, type QueueRow } from '@/lib/homeworkQueue'
import type { TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Строка очереди — только то, что нужно для решения «за какую работу взяться»:
 * кто сдал, что именно, когда и не опоздал ли. Комментарий, балл и кнопки
 * вердикта из списка убраны сознательно (решение владельца 2026-07-30): пока
 * работа не открыта, оценивать нечего, а форма на каждой карточке превращала
 * список в стену полей. Вердикт живёт внутри разбора.
 */
function QueueRowItem({
  row, files, studentName, onOpen,
}: {
  row: QueueRow
  files: TopicHomeworkAttemptFileRow[]
  studentName: string
  onOpen: () => void
}) {
  const { attempt } = row
  const late = isSubmittedLate(row)
  const submitted = formatDate(attempt.submitted_at)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="queue-attempt-card"
        data-attempt-id={attempt.id}
        data-late={late ? 'true' : 'false'}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{studentName}</span>
            {late && (
              <span
                data-testid="queue-late-badge"
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"
              >
                <AlertTriangle size={11} />
                Просрочено
              </span>
            )}
            {attempt.attempt_number > 1 && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                попытка №{attempt.attempt_number}
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-gray-500">
            {row.topicTitle} · {row.homeworkTitle}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
            {submitted && <span>Сдано {submitted}</span>}
            {files.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip size={11} />
                {files.length}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-gray-300" />
      </button>
    </li>
  )
}

/**
 * Общая очередь проверки ДЗ: все сданные работы по всем темам и курсам
 * преподавателя, старые сверху. Список — только для выбора работы; проверка
 * (рамки, комментарий, балл, вердикт) открывается по клику на строку.
 */
export function HomeworkReviewQueuePage() {
  const { rows, attemptFiles, studentNames, loading, error, reload, reviewAttempt } = useHomeworkReviewQueue()
  const [reviewing, setReviewing] = useState<QueueRow | null>(null)
  const filesOf = (attemptId: string) => attemptFiles.filter(f => f.attempt_id === attemptId)
  const groups = groupByCourse(rows)
  const lateCount = rows.filter(isSubmittedLate).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Проверка домашних заданий</h1>
          <p data-testid="queue-count" className="mt-0.5 text-sm text-gray-500">
            {loading
              ? 'Загрузка…'
              : rows.length === 0
                ? 'Всё проверено'
                : `Ждут проверки: ${rows.length}${lateCount > 0 ? ` · просрочено: ${lateCount}` : ''}`}
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
              <ul className="space-y-2">
                {g.rows.map(row => (
                  <QueueRowItem
                    key={row.attempt.id}
                    row={row}
                    files={filesOf(row.attempt.id)}
                    studentName={studentNames[row.attempt.student_id] ?? 'Ученик'}
                    onOpen={() => setReviewing(row)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {reviewing && (
        <AttemptAnnotationOverlay
          attemptId={reviewing.attempt.id}
          files={filesOf(reviewing.attempt.id)}
          title={reviewing.homeworkTitle}
          subtitle={
            `${studentNames[reviewing.attempt.student_id] ?? 'Ученик'} · ${reviewing.topicTitle}`
            + (isSubmittedLate(reviewing) ? ' · сдано с опозданием' : '')
          }
          // Решение принимает форма вердикта ниже — своя кнопка публикации в
          // тулбаре только путала: две зелёные кнопки читались как одно действие.
          hideToolbarPublish
          footer={({ publishAnnotations }) => (
            <ReviewActions
              attempt={reviewing.attempt}
              gradeScale={reviewing.gradeScale}
              hint="Рамки сохраняются сразу. Ученик увидит их, когда вы примете работу или вернёте на доработку — отдельно публиковать не нужно."
              onReview={async (attemptId, decision, comment, score) => {
                // Сначала пометки, потом вердикт: иначе ученик мог бы увидеть
                // «на доработку» без рамок, на которые ссылается комментарий.
                // Ошибку не глотаем — ReviewActions покажет её и оставит форму.
                const ok = await publishAnnotations(decision === 'accepted' ? 'checked' : 'revision')
                if (!ok) throw new Error('Не удалось опубликовать пометки — вердикт не сохранён')
                await reviewAttempt(attemptId, decision, comment, score)
                setReviewing(null)
              }}
            />
          )}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  )
}
