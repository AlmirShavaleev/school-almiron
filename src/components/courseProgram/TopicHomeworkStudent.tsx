import { useState } from 'react'
import { FileText, Loader2, Paperclip, Send, Trash2, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import {
  ATTEMPT_STATUS_LABEL,
  ATTEMPT_STATUS_TONE,
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  TOPIC_HOMEWORK_BUCKET,
  acceptedAttempt,
  activeAttempt,
  attemptsNewestFirst,
  canStartNewAttempt,
  formatBytes,
  latestReview,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

/**
 * Ученический блок PDF-ДЗ темы.
 *
 * Черновик ДЗ и чужие попытки сюда не приходят — их отсекает RLS вместе
 * с `topics.available_from`. Клиент ничего не перепроверяет: скрытие кнопки
 * «Сдать заново» после принятия — это UX, а запрет держит триггер в БД.
 */
export function TopicHomeworkStudent({ topicId, className }: { topicId: string; className?: string }) {
  const {
    homework, files, attempts, attemptFiles, reviews, loading, error,
    startAttempt, uploadAttemptFile, removeAttemptFile, submitAttempt,
  } = useTopicHomework(topicId)

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка задания…
      </div>
    )
  }

  // ДЗ нет или оно ещё не опубликовано — из БД просто ничего не пришло
  if (!homework) return null

  const active = activeAttempt(attempts)
  const accepted = acceptedAttempt(attempts)
  const taskFile = files[0] ?? null
  const draftFiles = active ? attemptFiles.filter(f => f.attempt_id === active.id) : []

  return (
    <div className={cn('rounded-2xl border border-gray-200 bg-white p-5', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileText size={16} className="text-primary-600" />
        <h2 className="text-base font-semibold text-gray-900">{homework.title}</h2>
        {accepted && (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE.accepted)}>
            {ATTEMPT_STATUS_LABEL.accepted}
          </span>
        )}
      </div>

      {homework.instructions && (
        <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{homework.instructions}</p>
      )}

      {taskFile && (
        <SignedFileLink
          bucket={TOPIC_HOMEWORK_BUCKET}
          url={taskFile.storage_path}
          className="mb-4 inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
        >
          <FileText size={14} />
          {taskFile.original_filename}
          {formatBytes(taskFile.size_bytes) && (
            <span className="text-xs text-gray-400">({formatBytes(taskFile.size_bytes)})</span>
          )}
        </SignedFileLink>
      )}

      {(error || localError) && (
        <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      {/* ── Текущая сдача ── */}
      {active && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">Попытка №{active.attempt_number}</span>
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[active.status])}>
              {ATTEMPT_STATUS_LABEL[active.status]}
            </span>
          </div>

          {draftFiles.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {draftFiles.map(f => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <SignedFileLink
                    bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
                    url={f.storage_path}
                    className="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-sm text-primary-600 hover:underline"
                  >
                    <Paperclip size={13} />
                    {f.file_name}
                  </SignedFileLink>
                  {active.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => run(() => removeAttemptFile(f.id, f.storage_path))}
                      aria-label="Убрать файл"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {active.status === 'draft' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary-600 hover:underline">
                <Upload size={14} />
                Добавить файл работы
                <input
                  type="file"
                  aria-label="Файл работы"
                  onChange={async e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    await run(() => uploadAttemptFile(active.id, file))
                    e.target.value = ''
                  }}
                  className="hidden"
                />
              </label>
              <Button
                size="sm"
                onClick={() => run(() => submitAttempt(active.id))}
                loading={busy}
                disabled={draftFiles.length === 0}
                title={draftFiles.length === 0 ? 'Сначала прикрепите работу' : undefined}
              >
                <Send size={14} />
                Отправить на проверку
              </Button>
            </div>
          )}

          {active.status === 'submitted' && (
            <p className="text-sm text-gray-500">Работа отправлена, ждёт проверки преподавателя.</p>
          )}
        </div>
      )}

      {/* ── Начать сдачу ── */}
      {!active && !accepted && (
        <Button onClick={() => run(() => startAttempt())} loading={busy}>
          <Upload size={15} />
          {attempts.length === 0 ? 'Загрузить работу' : 'Сдать заново'}
        </Button>
      )}

      {/* Кнопки новой сдачи после «Принято» нет — так же запрещает и база */}

      {/* ── История попыток ── */}
      {attempts.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            История попыток
          </div>
          <ul className="space-y-2">
            {attemptsNewestFirst(attempts).map(a => {
              const review = latestReview(reviews, a.id)
              const attFiles = attemptFiles.filter(f => f.attempt_id === a.id)
              return (
                <li key={a.id} className="rounded-xl border border-gray-200 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">Попытка №{a.attempt_number}</span>
                    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[a.status])}>
                      {ATTEMPT_STATUS_LABEL[a.status]}
                    </span>
                    {a.submitted_at && (
                      <span className="text-xs text-gray-400">
                        {new Date(a.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                      </span>
                    )}
                  </div>

                  {attFiles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {attFiles.map(f => (
                        <SignedFileLink
                          key={f.id}
                          bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
                          url={f.storage_path}
                          className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:underline"
                        >
                          <Paperclip size={12} />
                          {f.file_name}
                        </SignedFileLink>
                      ))}
                    </div>
                  )}

                  {review?.comment && (
                    <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      {review.comment}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {canStartNewAttempt(attempts) && attempts.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">Работа возвращена на доработку — можно сдать ещё раз.</p>
      )}
    </div>
  )
}
