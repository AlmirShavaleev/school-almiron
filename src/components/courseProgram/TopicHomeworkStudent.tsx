import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Paperclip, Send, SquareDashed, Trash2, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { AttemptAnnotationOverlay } from './AttemptAnnotationOverlay'
import {
  ATTEMPT_STATUS_LABEL,
  ATTEMPT_STATUS_TONE,
  HOMEWORK_FILE_ACCEPT,
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  TOPIC_HOMEWORK_BUCKET,
  acceptedAttempt,
  activeAttempt,
  attemptsNewestFirst,
  canStartNewAttempt,
  formatBytes,
  formatDue,
  gradeScaleMax,
  isOverdue,
  latestReview,
  namePastedFile,
  splitHomeworkFiles,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

/**
 * Ученический блок ДЗ темы.
 *
 * Черновик ДЗ и чужие попытки сюда не приходят — их отсекает RLS вместе
 * с `topics.available_from`. Клиент ничего не перепроверяет: скрытие кнопки
 * «Сдать заново» после принятия — это UX, а запрет держит триггер в БД.
 */
export function TopicHomeworkStudent({ topicId, className }: { topicId: string; className?: string }) {
  const {
    homework, files, attempts, attemptFiles, reviews, loading, error,
    startAttempt, uploadAttemptFiles, removeAttemptFile, submitAttempt,
  } = useTopicHomework(topicId)

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // Прогресс сдачи файлов — отдельно от busy: раньше один общий busy на
  // «прикрепить» и «отправить» заставлял кнопку «Отправить на проверку»
  // мигать спиннером во время простой загрузки фото. Теперь у сдачи
  // файлов свой честный индикатор (имя + %), как у преподавателя при
  // выдаче задания (uploadHomeworkFiles) — тот же приём через XHR.
  const [uploads, setUploads] = useState<{ name: string; percent: number }[]>([])
  const uploadingFiles = uploads.length > 0

  // По каким попыткам учитель ОПУБЛИКОВАЛ рамки с ошибками. Черновые пометки
  // сюда не попадут — их отсекает RLS (annotation_sets_select пускает ученика
  // только к status='published' своей попытки), так что фильтр по статусу
  // здесь ради явности, а не вместо базы. Нужно, чтобы не показывать кнопку
  // «Пометки учителя», ведущую в пустой просмотр.
  const [annotatedAttempts, setAnnotatedAttempts] = useState<Set<string>>(new Set())
  const [viewingMarks, setViewingMarks] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const attemptIdsKey = attempts.map(a => a.id).sort().join(',')

  useEffect(() => {
    const ids = attemptIdsKey ? attemptIdsKey.split(',') : []
    if (ids.length === 0) {
      setAnnotatedAttempts(new Set())
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await (supabase as any)
        .from('annotation_sets')
        .select('attempt_id')
        .in('attempt_id', ids)
        .eq('status', 'published')
      if (cancelled) return
      setAnnotatedAttempts(new Set((data ?? []).map((r: { attempt_id: string }) => r.attempt_id)))
    })()
    return () => { cancelled = true }
  }, [attemptIdsKey])

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

  /**
   * Единая точка приёма файлов для всех трёх способов: кнопка выбора,
   * перетаскивание и вставка из буфера. Отбор и переименование — общие
   * (splitHomeworkFiles / namePastedFile), чтобы способы не разъезжались.
   */
  const uploadPicked = useCallback(
    async (attemptId: string, incoming: File[], { fromPaste = false } = {}) => {
      if (incoming.length === 0) return
      const { accepted, rejected } = splitHomeworkFiles(incoming)
      const picked = fromPaste ? accepted.map(namePastedFile) : accepted

      if (rejected.length > 0) {
        setLocalError(
          `Можно приложить только PDF и картинки. Не подошло: ${rejected.map(f => f.name).join(', ')}`,
        )
      } else {
        setLocalError(null)
      }
      if (picked.length === 0) return

      setUploads(picked.map(f => ({ name: f.name, percent: 0 })))
      try {
        await uploadAttemptFiles(attemptId, picked, (index, percent) => {
          setUploads(prev => prev.map((u, i) => (i === index ? { ...u, percent } : u)))
        })
      } catch (err: any) {
        setLocalError(err?.message ?? 'Не удалось загрузить файлы')
      } finally {
        setUploads([])
      }
    },
    [uploadAttemptFiles],
  )

  // Черновик, в который сейчас можно докладывать файлы. Считаем до ранних
  // return'ов: обработчик вставки — хук, он обязан вызываться всегда.
  const draftAttempt = attempts.find(a => a.status === 'draft') ?? null
  const draftAttemptId = draftAttempt?.id ?? null

  /**
   * Вставка из буфера обмена (Ctrl/Cmd+V).
   *
   * Ради этого всё и затевалось: скриншот решения лежит в буфере, и раньше
   * ученику приходилось сначала сохранять его файлом, потом искать через
   * «Обзор». Теперь достаточно вставить. Слушаем на документе, а не на поле:
   * ученик не станет специально фокусироваться на зоне загрузки.
   */
  useEffect(() => {
    if (!draftAttemptId || uploadingFiles) return
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null
      // Не перехватываем вставку текста в поля ввода.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void uploadPicked(draftAttemptId!, files, { fromPaste: true })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [draftAttemptId, uploadingFiles, uploadPicked])

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

  const isPastDue = isOverdue(homework.due_at) && active && !accepted
  const gradeMax = gradeScaleMax(homework.grade_scale)
  const lastReview = accepted ? latestReview(reviews, accepted.id) : null
  const showGrade = accepted && homework.grade_scale && lastReview?.score !== null && lastReview?.score !== undefined

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
        {formatDue(homework.due_at) && (
          <span className="text-xs text-gray-500">{formatDue(homework.due_at)}</span>
        )}
        {isPastDue && (
          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            Просрочено
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

      {showGrade && (
        <div data-testid="hw-grade" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">Оценка</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">
            {lastReview.score} / {gradeMax}
          </div>
        </div>
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
                      disabled={busy || uploadingFiles}
                      aria-label="Убрать файл"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Индикатор загрузки: имя файла + честный % через XHR-прогресс,
              один на каждое сдаваемое фото/PDF — видно прямо во время сдачи,
              а не только «спиннер и тишина» до завершения. */}
          {uploadingFiles && (
            <ul className="mb-3 space-y-1.5">
              {uploads.map((u, i) => (
                <li key={`${u.name}-${i}`}>
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="truncate">{u.name}</span>
                    <span className="shrink-0 tabular-nums">{u.percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all"
                      style={{ width: `${u.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {active.status === 'draft' && (
            <div className="space-y-3">
              {/*
                Зона приёма работы. Три способа вместо одного «Обзора»:
                выбрать файл, перетащить, вставить из буфера. Последний —
                главный: скриншот решения уже в буфере, и сохранять его
                файлом только ради загрузки было лишним шагом.
              */}
              <label
                data-testid="hw-dropzone"
                onDragOver={e => { e.preventDefault(); if (!uploadingFiles) setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={async e => {
                  e.preventDefault()
                  setDragOver(false)
                  if (uploadingFiles) return
                  await uploadPicked(active.id, Array.from(e.dataTransfer.files ?? []))
                }}
                className={cn(
                  'flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                  uploadingFiles
                    ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                    : dragOver
                      ? 'cursor-copy border-primary-400 bg-primary-50'
                      : 'cursor-pointer border-gray-300 bg-white hover:border-primary-300 hover:bg-primary-50/30',
                )}
              >
                {uploadingFiles ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                    <span className="text-sm text-gray-500">Загрузка…</span>
                  </>
                ) : (
                  <>
                    <Upload size={20} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">
                      Перетащите фото или PDF, либо нажмите чтобы выбрать
                    </span>
                    <span className="text-xs text-gray-400">
                      Скриншот можно просто вставить — Ctrl+V
                    </span>
                  </>
                )}
                <input
                  data-testid="hw-attempt-file-input"
                  type="file"
                  accept={HOMEWORK_FILE_ACCEPT}
                  multiple
                  disabled={uploadingFiles}
                  aria-label="Файлы работы"
                  onChange={async e => {
                    const picked = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    await uploadPicked(active.id, picked)
                  }}
                  className="hidden"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  data-testid="hw-submit-attempt"
                  size="sm"
                  onClick={() => run(() => submitAttempt(active.id))}
                  loading={busy}
                  disabled={draftFiles.length === 0 || uploadingFiles}
                  title={draftFiles.length === 0 ? 'Сначала прикрепите работу' : undefined}
                >
                  <Send size={14} />
                  Отправить на проверку
                </Button>
                {draftFiles.length === 0 && (
                  <span className="text-xs text-gray-400">Сначала прикрепите работу</span>
                )}
              </div>
            </div>
          )}

          {active.status === 'submitted' && (
            <p className="text-sm text-gray-500">Работа отправлена, ждёт проверки преподавателя.</p>
          )}
        </div>
      )}

      {/* ── Начать сдачу ── */}
      {!active && !accepted && (
        <Button data-testid="hw-start-attempt" onClick={() => run(() => startAttempt())} loading={busy}>
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
                <li key={a.id} data-testid="hw-attempt-row" data-status={a.status} className="rounded-xl border border-gray-200 px-3 py-2.5">
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

                  {annotatedAttempts.has(a.id) && (
                    <button
                      type="button"
                      data-testid="hw-view-marks-button"
                      onClick={() => setViewingMarks(a.id)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:border-rose-300"
                    >
                      <SquareDashed size={12} />
                      Пометки учителя на работе
                    </button>
                  )}

                  {review?.comment && (
                    <p data-testid="hw-review-comment" className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      {review.comment}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {viewingMarks && (
        <AttemptAnnotationOverlay
          attemptId={viewingMarks}
          files={attemptFiles.filter(f => f.attempt_id === viewingMarks)}
          title={homework.title}
          subtitle="Пометки учителя — нажмите на рамку, чтобы прочитать замечание"
          readOnly
          onClose={() => setViewingMarks(null)}
        />
      )}

      {canStartNewAttempt(attempts) && attempts.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">Работа возвращена на доработку — можно сдать ещё раз.</p>
      )}
    </div>
  )
}
