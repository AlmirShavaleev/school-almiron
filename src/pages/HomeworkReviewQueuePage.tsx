import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronRight, Eye, Inbox, Loader2, Paperclip, RefreshCw,
} from 'lucide-react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'
import { AiCheckPanel } from '@/components/courseProgram/AiCheckPanel'
import type { ImportedRegion } from '@/components/SubmissionReviewer'
import { findingsToRegions } from '@/lib/aiHomeworkCheck'
import { useHomeworkAiCheck } from '@/hooks/useHomeworkAiCheck'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'
import { useReviewPresence } from '@/hooks/useReviewPresence'
import { groupByCourse, isSubmittedLate, type QueueRow } from '@/lib/homeworkQueue'
import { viewersLabel, viewersOfAttempt, type PresenceMeta } from '@/lib/reviewPresence'
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
  row, files, studentName, viewers, onOpen,
}: {
  row: QueueRow
  files: TopicHomeworkAttemptFileRow[]
  studentName: string
  /** Коллеги, открывшие эту работу прямо сейчас. */
  viewers: PresenceMeta[]
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
            {viewers.length > 0 && (
              <span
                data-testid="queue-viewer-badge"
                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
              >
                <Eye size={11} />
                {viewersLabel(viewers)}
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
  /**
   * `locked` снимается один раз — в момент открытия. Дальше кнопка «Всё равно
   * редактировать» его сбрасывает, а приход нового зрителя уже не возвращает:
   * иначе коллега, зашедший посмотреть, выбивал бы из редактирования того, кто
   * начал первым.
   */
  const [reviewing, setReviewing] = useState<{ row: QueueRow; locked: boolean } | null>(null)
  const filesOf = (attemptId: string) => attemptFiles.filter(f => f.attempt_id === attemptId)
  const groups = groupByCourse(rows)
  const lateCount = rows.filter(isSubmittedLate).length

  const courseIds = useMemo(() => rows.map(r => r.courseId), [rows])
  const { viewers } = useReviewPresence({ courseIds, attemptId: reviewing?.row.attempt.id ?? null })
  const viewersOf = (attemptId: string) => viewersOfAttempt(viewers, attemptId)

  // ── Черновик ИИ ─────────────────────────────────────────────────────
  const openAttemptId = reviewing?.row.attempt.id ?? null
  const ai = useHomeworkAiCheck(openAttemptId)
  // Перенос рамок делает сам аннотатор: он владеет страницами и умеет их
  // сохранять. Отсюда ref вместо проброса данных вниз.
  const importRegionsRef = useRef<((regions: ImportedRegion[]) => Promise<number>) | null>(null)
  const [fillRequest, setFillRequest] = useState<{ comment?: string } | null>(null)

  async function applyAiFrames(): Promise<number> {
    const importRegions = importRegionsRef.current
    if (!importRegions) throw new Error('Разбор ещё не готов — попробуйте через секунду')
    // Находка ссылается на файл по id, аннотатор адресует страницы по пути.
    const pathById = Object.fromEntries(attemptFiles.map(f => [f.id, f.storage_path]))
    const count = await importRegions(findingsToRegions(ai.findings, pathById))
    if (count > 0 && ai.job) {
      // Отметка «черновик забрали» — для статистики пользы ИИ, а не для логики.
      // Её сбой не должен выглядеть как несработавший перенос.
      try { await ai.markAccepted(ai.job.id) } catch { /* рамки уже перенесены */ }
    }
    return count
  }

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
                    viewers={viewersOf(row.attempt.id)}
                    onOpen={() => setReviewing({ row, locked: viewersOf(row.attempt.id).length > 0 })}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {reviewing && (
        <AttemptAnnotationOverlay
          attemptId={reviewing.row.attempt.id}
          files={filesOf(reviewing.row.attempt.id)}
          title={reviewing.row.homeworkTitle}
          subtitle={
            `${studentNames[reviewing.row.attempt.student_id] ?? 'Ученик'} · ${reviewing.row.topicTitle}`
            + (isSubmittedLate(reviewing.row) ? ' · сдано с опозданием' : '')
          }
          viewers={viewersOf(reviewing.row.attempt.id)}
          locked={reviewing.locked}
          onForceEdit={() => setReviewing(r => (r ? { ...r, locked: false } : r))}
          // Решение принимает форма вердикта ниже — своя кнопка публикации в
          // тулбаре только путала: две зелёные кнопки читались как одно действие.
          hideToolbarPublish
          importRegionsRef={importRegionsRef}
          footer={({ publishAnnotations }) => (
            <ReviewActions
              attempt={reviewing.row.attempt}
              gradeScale={reviewing.row.gradeScale}
              hint="Рамки сохраняются сразу. Ученик увидит их, когда вы примете работу или вернёте на доработку — отдельно публиковать не нужно."
              above={
                <AiCheckPanel
                  job={ai.job}
                  findings={ai.findings}
                  running={ai.running}
                  error={ai.error}
                  onRun={ai.runCheck}
                  onApplyFrames={applyAiFrames}
                  // Новый объект на каждое нажатие: вставить один и тот же
                  // текст второй раз тоже должно получаться.
                  onUseText={text => setFillRequest({ comment: text })}
                />
              }
              fillRequest={fillRequest}
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
