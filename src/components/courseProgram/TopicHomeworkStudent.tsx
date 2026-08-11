import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, FileText, Loader2, Paperclip, Send, SquareDashed, Trash2, Upload,
} from 'lucide-react'
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
  dueUrgency,
  formatBytes,
  formatDue,
  gradeScaleMax,
  isOverdue,
  latestReview,
  moveItem,
  namePastedFile,
  splitHomeworkFiles,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { getSignedFileUrl } from '@/lib/storage'
import type { TopicHomeworkAttemptFileRow } from '@/lib/topicHomework'

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
    startAttempt, uploadAttemptFiles, removeAttemptFile, reorderAttemptFiles, submitAttempt,
  } = useTopicHomework(topicId)

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<{ name: string; percent: number }[]>([])
  const uploadingFiles = uploads.length > 0

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

  const draftAttempt = attempts.find(a => a.status === 'draft') ?? null
  const draftAttemptId = draftAttempt?.id ?? null

  useEffect(() => {
    if (!draftAttemptId || uploadingFiles) return
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null
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

  if (!homework) return null

  const active = activeAttempt(attempts)
  const accepted = acceptedAttempt(attempts)
  const taskFile = files[0] ?? null
  const draftFiles = active ? attemptFiles.filter(f => f.attempt_id === active.id) : []

  const gradeMax = gradeScaleMax(homework.grade_scale)
  const lastReview = accepted ? latestReview(reviews, accepted.id) : null
  const showGrade = accepted && homework.grade_scale && lastReview?.score !== null && lastReview?.score !== undefined

  // Определяем состояние шагов
  const submittedOrBetter = attempts.some(a => ['submitted', 'accepted', 'returned_for_revision'].includes(a.status))
  const stepSubmitted = submittedOrBetter ? 'done' : (active ? 'current' : 'future')

  const acceptedOrReturned = attempts.some(a => ['accepted', 'returned_for_revision'].includes(a.status))
  const stepReviewed = acceptedOrReturned ? 'done' : (active?.status === 'submitted' ? 'current' : 'future')

  // Срок
  const urgency = dueUrgency(homework.due_at)
  const showDeadlineBanner = urgency.level !== 'none' && (!active || active.status === 'draft')

  function pluralizeDays(n: number): string {
    if (n % 10 === 1 && n % 100 !== 11) return 'день'
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня'
    return 'дней'
  }

  function getDeadlineText(): string {
    switch (urgency.level) {
      case 'calm':
        return `осталось ${urgency.days} ${pluralizeDays(urgency.days)}`
      case 'soon':
        if (urgency.days === 0) return 'сдать сегодня'
        return `осталось ${urgency.days} ${pluralizeDays(urgency.days)}`
      case 'overdue':
        if (urgency.days === 0) return 'срок истёк сегодня'
        return `просрочено на ${urgency.days} ${pluralizeDays(urgency.days)}`
      default:
        return ''
    }
  }

  function getDeadlineTone(): { bg: string; text: string; sub: string } {
    switch (urgency.level) {
      case 'calm':
        return { bg: 'bg-gray-50', text: 'text-gray-900', sub: 'text-gray-500' }
      case 'soon':
        return { bg: 'bg-amber-50', text: 'text-amber-900', sub: 'text-amber-700' }
      case 'overdue':
        return { bg: 'bg-red-50', text: 'text-red-900', sub: 'text-red-700' }
      default:
        return { bg: '', text: '', sub: '' }
    }
  }

  function getAttemptStatusColor(status: string): { bg: string; border: string } {
    switch (status) {
      case 'accepted':
        return { bg: 'bg-emerald-600', border: 'border-emerald-600' }
      case 'returned_for_revision':
        return { bg: 'bg-amber-500', border: 'border-amber-500' }
      case 'submitted':
        return { bg: 'bg-blue-500', border: 'border-blue-500' }
      default:
        return { bg: 'bg-gray-400', border: 'border-gray-400' }
    }
  }

  const tone = getDeadlineTone()

  return (
    <div className={cn('rounded-2xl border border-gray-200 bg-white p-5', className)}>
      {/* ── Шапка ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{homework.title}</h2>
        {accepted && (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE.accepted)}>
            {ATTEMPT_STATUS_LABEL.accepted}
          </span>
        )}
        {formatDue(homework.due_at) && (
          <span className="ml-auto text-xs text-gray-500">{formatDue(homework.due_at)}</span>
        )}
      </div>

      {/* ── Инструкция ── */}
      {homework.instructions && (
        <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{homework.instructions}</p>
      )}

      {/* ── Полоса шагов ── */}
      <div data-testid="hw-steps" className="mb-4 flex items-center gap-0">
        {/* Шаг 1: Выдано */}
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white border-2 border-emerald-600">✓</div>
          <span className="text-xs font-semibold text-emerald-700">Выдано</span>
        </div>

        {/* Полоса 1 */}
        <div className="flex-1 mx-2 h-0.5 bg-emerald-600"></div>

        {/* Шаг 2: Сдано */}
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold border-2',
            stepSubmitted === 'done'
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : stepSubmitted === 'current'
                ? 'border-primary-500 text-primary-600 bg-white'
                : 'border-gray-200 text-gray-400 bg-white'
          )}>
            {stepSubmitted === 'done' ? '✓' : '2'}
          </div>
          <span className={cn(
            'text-xs font-semibold',
            stepSubmitted === 'done'
              ? 'text-emerald-700'
              : stepSubmitted === 'current'
                ? 'text-primary-700'
                : 'text-gray-400'
          )}>
            Сдано
          </span>
        </div>

        {/* Полоса 2 */}
        <div className={cn(
          'flex-1 mx-2 h-0.5',
          stepReviewed === 'done' ? 'bg-emerald-600' : 'bg-gray-200'
        )}></div>

        {/* Шаг 3: Проверено */}
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold border-2',
            stepReviewed === 'done'
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : stepReviewed === 'current'
                ? 'border-primary-500 text-primary-600 bg-white'
                : 'border-gray-200 text-gray-400 bg-white'
          )}>
            {stepReviewed === 'done' ? '✓' : '3'}
          </div>
          <span className={cn(
            'text-xs font-semibold',
            stepReviewed === 'done'
              ? 'text-emerald-700'
              : stepReviewed === 'current'
                ? 'text-primary-700'
                : 'text-gray-400'
          )}>
            Проверено
          </span>
        </div>
      </div>

      {/* ── Баннер срока ── */}
      {showDeadlineBanner && (
        <div data-testid="hw-deadline-banner" className={cn('mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl px-4 py-3', tone.bg)}>
          <span className={cn('text-base font-bold', tone.text)}>
            {/* +T00:00:00 — иначе голая дата парсится как полночь UTC и в
                отрицательных поясах уезжает на день назад */}
            Срок: {homework.due_at ? new Date(homework.due_at.slice(0, 10) + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''}
          </span>
          <span className={cn('text-sm font-medium', tone.sub)}>
            {getDeadlineText()}
          </span>
        </div>
      )}

      {(error || localError) && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      {/* ── Условие ── */}
      {taskFile && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Условие</div>
          <SignedFileLink
            bucket={TOPIC_HOMEWORK_BUCKET}
            url={taskFile.storage_path}
            className="flex items-center gap-3 border border-gray-200 bg-gray-50 rounded-2xl p-3 text-decoration-none hover:border-primary-500"
          >
            <div className="flex-none w-11 h-11 rounded-2xl bg-red-500 flex items-center justify-center text-xs font-extrabold text-white">PDF</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900 truncate">{taskFile.original_filename}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                PDF · {formatBytes(taskFile.size_bytes) && <span>({formatBytes(taskFile.size_bytes)})</span>}
              </div>
            </div>
          </SignedFileLink>
        </div>
      )}

      {/* ── Оценка и пометки (если принято) ── */}
      {accepted && (
        <div data-testid="hw-grade" className="mt-4 bg-emerald-50 rounded-2xl p-4 flex items-center gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Оценка</div>
            {showGrade ? (
              <div className="text-3xl font-extrabold text-emerald-700 mt-1 leading-none">
                {lastReview?.score} / {gradeMax}
              </div>
            ) : null}
          </div>
          <div className="ml-auto text-right">
            {annotatedAttempts.has(accepted.id) && (
              <button
                type="button"
                onClick={() => setViewingMarks(accepted.id)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:border-primary-200"
              >
                ✏ Посмотреть пометки учителя
              </button>
            )}
            <div className="text-xs text-gray-400 mt-1.5">
              Принято {accepted.submitted_at ? new Date(accepted.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '?'} · попытка №{accepted.attempt_number}
            </div>
          </div>
        </div>
      )}

      {/* ── Сборка сдачи (только если есть черновик) ── */}
      {active && active.status === 'draft' && (
        <div className="mt-4">
          {/* Заголовок с числом страниц */}
          <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Моя работа{draftFiles.length > 0 ? ` · ${draftFiles.length} ${draftFiles.length === 1 ? 'страница' : draftFiles.length <= 4 ? 'страницы' : 'страниц'}` : ''}
          </div>

          {/* Сетка миниатюр с перестановкой */}
          {draftFiles.length > 0 && (
            <PageGrid
              files={draftFiles}
              disabled={busy || uploadingFiles}
              onReorder={ids => run(() => reorderAttemptFiles(active.id, ids))}
              onDelete={f => run(() => removeAttemptFile(f.id, f.storage_path))}
            />
          )}

          {/* Прогресс загрузки */}
          {uploadingFiles && (
            <ul className="mb-4 space-y-1.5">
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

          {/* Дропзона */}
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
              'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors mt-4',
              uploadingFiles
                ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                : dragOver
                  ? 'cursor-copy border-primary-400 bg-primary-50'
                  : 'cursor-pointer border-gray-300 bg-white hover:border-primary-300 hover:bg-primary-50/30',
            )}
          >
            {uploadingFiles ? (
              <>
                <Loader2 size={24} className="animate-spin text-gray-400" />
                <span className="text-sm text-gray-500">Загрузка…</span>
              </>
            ) : (
              <>
                <span className="text-2xl">📷</span>
                <div className="text-sm font-semibold text-gray-700">Перетащите фото или PDF — или нажмите, чтобы выбрать</div>
                <div className="text-xs text-gray-400">Скриншот можно просто вставить: Ctrl+V</div>
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

          {/* Кнопка отправления */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              data-testid="hw-submit-attempt"
              onClick={() => run(() => submitAttempt(active.id))}
              loading={busy}
              disabled={draftFiles.length === 0 || uploadingFiles}
              title={draftFiles.length === 0 ? 'Сначала прикрепите работу' : undefined}
            >
              Отправить на проверку
            </Button>
            {/*
              Подпись описывает ровно то, что умеет экран. До §113 здесь было
              обещание перетаскивания, которого не существовало ни в одном
              обработчике: стрелки называем первыми — они и есть основной способ.
            */}
            <small className="text-gray-400">
              {draftFiles.length} {draftFiles.length === 1 ? 'страница' : draftFiles.length <= 4 ? 'страницы' : 'страниц'}
              {draftFiles.length > 1 && ' · порядок меняется стрелками ← → или перетаскиванием'}
            </small>
          </div>

          <div className="text-xs text-gray-500 mt-2.5">
            После отправки страницы изменить нельзя — учитель получит их в этом порядке.
          </div>
        </div>
      )}

      {/* ── Сообщение "ждёт проверки" ── */}
      {active && active.status === 'submitted' && (
        <div className="mt-4 text-sm text-gray-500">
          Работа отправлена, ждёт проверки преподавателя.
        </div>
      )}

      {/* ── Начать сдачу ── */}
      {!active && !accepted && (
        <div className="mt-4">
          <Button
            data-testid="hw-start-attempt"
            onClick={() => run(() => startAttempt())}
            loading={busy}
          >
            <Upload size={15} />
            {attempts.length === 0 ? 'Загрузить работу' : 'Сдать заново'}
          </Button>
        </div>
      )}

      {/* ── История попыток (лента) ── */}
      {attempts.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">История попыток</div>
          <div className="relative pl-6">
            {/* Вертикальная линия */}
            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200"></div>

            <div className="space-y-4">
              {attemptsNewestFirst(attempts).map(a => {
                const review = latestReview(reviews, a.id)
                const attFiles = attemptFiles.filter(f => f.attempt_id === a.id)
                const colors = getAttemptStatusColor(a.status)

                return (
                  <div key={a.id} className="relative">
                    {/* Точка на ленте */}
                    <div className={cn(
                      'absolute -left-4 top-1 w-3 h-3 rounded-full border-2',
                      colors.border,
                      colors.bg
                    )}></div>

                    {/* Содержимое события */}
                    <div>
                      {/* Дата и время */}
                      {a.submitted_at && (
                        <div className="text-xs text-gray-400">
                          {new Date(a.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {new Date(a.submitted_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}

                      {/* Попытка + статус */}
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-sm font-semibold text-gray-900">Попытка №{a.attempt_number}</span>
                        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[a.status])}>
                          {ATTEMPT_STATUS_LABEL[a.status]}
                        </span>
                      </div>

                      {/* Файлы чипами */}
                      {attFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {attFiles.map(f => (
                            <SignedFileLink
                              key={f.id}
                              bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
                              url={f.storage_path}
                              className="inline-flex items-center gap-2 border border-gray-200 bg-white rounded-2xl px-2.5 py-1.5 text-xs hover:border-primary-300"
                            >
                              <span className={cn(
                                'flex-none w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold text-white',
                                f.mime_type?.startsWith('image/') ? 'bg-blue-500' : 'bg-red-500'
                              )}>
                                {f.mime_type?.startsWith('image/') ? 'IMG' : 'PDF'}
                              </span>
                              <span className="text-gray-700 truncate">{f.file_name}</span>
                            </SignedFileLink>
                          ))}
                        </div>
                      )}

                      {/* Комментарий учителя */}
                      {review?.comment && (
                        <div className="mt-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2 flex gap-2 text-xs text-amber-800">
                          <span>💬</span>
                          <div>
                            <div className="font-bold">Комментарий учителя:</div>
                            <div>{review.comment}</div>
                          </div>
                        </div>
                      )}

                      {/* Кнопка пометок */}
                      {annotatedAttempts.has(a.id) && (
                        <button
                          type="button"
                          data-testid="hw-view-marks-button"
                          onClick={() => setViewingMarks(a.id)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-2xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:border-primary-200"
                        >
                          ✏ Пометки учителя
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {canStartNewAttempt(attempts) && attempts.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">Работа возвращена на доработку — можно сдать ещё раз.</p>
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
    </div>
  )
}

/**
 * Сетка страниц работы с перестановкой ДВУМЯ способами.
 *
 * Стрелки — основной: они работают с клавиатуры, на любом экране и не зависят
 * от точности жеста. Перетаскивание — второй, для тех, кому так быстрее.
 *
 * Перетаскивание сделано на Pointer Events, а не на HTML5 drag-and-drop:
 * html5-перетаскивание на тач-экране не работает вовсе, а подпись под кнопкой
 * обещает его всем. Один обработчик закрывает и мышь, и палец.
 *
 * Мышью можно тащить всю миниатюру, пальцем — только за ручку с номером
 * страницы: `touch-action: none` на всей плитке отняло бы у пальца прокрутку
 * страницы, а плитки маленькие и попасть мимо легко.
 */
function PageGrid({
  files, disabled, onReorder, onDelete,
}: {
  files: TopicHomeworkAttemptFileRow[]
  disabled: boolean
  onReorder: (orderedIds: string[]) => void
  onDelete: (file: TopicHomeworkAttemptFileRow) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  /** Идёт перетаскивание: откуда взяли и над какой позицией сейчас. */
  const [drag, setDrag] = useState<{ pointerId: number; from: number; over: number } | null>(null)

  // Пока тащим — показываем БУДУЩИЙ порядок, иначе непонятно, куда упадёт.
  // Номера страниц пересчитываются здесь же: они и есть подтверждение.
  const shown = drag ? moveItem(files, drag.from, drag.over) : files

  function indexAtPoint(x: number, y: number): number | null {
    const grid = gridRef.current
    if (!grid) return null
    const thumbs = Array.from(grid.querySelectorAll<HTMLElement>('[data-page-index]'))
    let nearest: { index: number; distance: number } | null = null

    for (const el of thumbs) {
      const index = Number(el.dataset.pageIndex)
      const rect = el.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return index
      // Точное попадание — не всегда: между плитками есть зазоры, а палец
      // дрожит. Поэтому запасной вариант — ближайшая по центру.
      const dx = x - (rect.left + rect.width / 2)
      const dy = y - (rect.top + rect.height / 2)
      const distance = Math.hypot(dx, dy)
      if (!nearest || distance < nearest.distance) nearest = { index, distance }
    }
    return nearest?.index ?? null
  }

  function startDrag(e: React.PointerEvent, index: number) {
    if (disabled || files.length < 2) return
    const el = e.currentTarget as HTMLElement
    // Захват указателя — не везде: в jsdom его нет вовсе, а в старых браузерах
    // он необязателен. Без него перетаскивание просто менее цепкое, ронять
    // из-за этого весь обработчик нельзя.
    el.setPointerCapture?.(e.pointerId)
    setDrag({ pointerId: e.pointerId, from: index, over: index })
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const over = indexAtPoint(e.clientX, e.clientY)
    if (over == null || over === drag.over) return
    setDrag({ ...drag, over })
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return
    const { from, over } = drag
    setDrag(null)
    if (from !== over) onReorder(moveItem(files, from, over).map(f => f.id))
  }

  function move(index: number, delta: number) {
    const to = index + delta
    if (to < 0 || to >= files.length) return
    onReorder(moveItem(files, index, to).map(f => f.id))
  }

  return (
    <div ref={gridRef} data-testid="hw-page-grid" className="flex gap-2.5 flex-wrap mb-4">
      {shown.map((f, idx) => (
        <PageThumb
          key={f.id}
          file={f}
          index={idx}
          pageNumber={idx + 1}
          total={shown.length}
          dragging={!!drag && shown[drag.over]?.id === f.id}
          disabled={disabled}
          onDelete={() => onDelete(f)}
          onMove={delta => move(idx, delta)}
          onPointerDownThumb={e => { if (e.pointerType === 'mouse') startDrag(e, idx) }}
          onPointerDownHandle={e => startDrag(e, idx)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
      ))}
    </div>
  )
}

/**
 * Миниатюра страницы в сетке сборки.
 *
 * Картинка подписывается один раз при монтировании: бакет приватный, прямых
 * ссылок у него нет — тот же приём, что в HomeworkAttemptDetailModal. Пока
 * ссылка не пришла или файл не картинка — серый квадрат с иконкой.
 */
function PageThumb({
  file,
  index,
  pageNumber,
  total,
  dragging,
  onDelete,
  onMove,
  onPointerDownThumb,
  onPointerDownHandle,
  onPointerMove,
  onPointerUp,
  disabled,
}: {
  file: TopicHomeworkAttemptFileRow
  index: number
  pageNumber: number
  total: number
  dragging: boolean
  onDelete: () => void
  onMove: (delta: -1 | 1) => void
  onPointerDownThumb: (e: React.PointerEvent) => void
  onPointerDownHandle: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  disabled: boolean
}) {
  const isImage = !!file.mime_type?.startsWith('image/')
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    getSignedFileUrl(TOPIC_HOMEWORK_ATTEMPTS_BUCKET, file.storage_path)
      .then(url => { if (!cancelled) setSignedUrl(url) })
      .catch(() => { /* останется иконка — миниатюра не стоит ошибки */ })
    return () => { cancelled = true }
  }, [isImage, file.storage_path])

  return (
    <div
      data-testid="hw-page-thumb"
      data-page-index={index}
      data-page-number={pageNumber}
      data-file-id={file.id}
      className="relative"
      onPointerDown={onPointerDownThumb}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={cn(
          'w-20 h-28 rounded-2xl border bg-gradient-to-b from-white to-slate-100 flex items-center justify-center relative shadow-sm overflow-hidden',
          dragging ? 'border-primary-400 ring-2 ring-primary-200' : 'border-gray-200',
        )}
      >
        {isImage && signedUrl ? (
          <img
            src={signedUrl}
            alt={`Страница ${pageNumber}`}
            loading="lazy"
            // Иначе браузер запускает СВОЁ перетаскивание картинки и наш
            // указатель теряется на первом же движении.
            draggable={false}
            className="w-full h-full object-cover select-none"
          />
        ) : (
          <FileText size={32} className="text-gray-400" />
        )}
        <button
          type="button"
          onClick={onDelete}
          onPointerDown={e => e.stopPropagation()}
          disabled={disabled}
          className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-600 text-sm font-bold disabled:opacity-40"
          aria-label={`Убрать страницу ${pageNumber}`}
        >
          ×
        </button>
      </div>

      {/*
        Ряд управления порядком. Кнопки настоящие: их видит скринридер, до них
        доходит Tab, и подпись говорит, что именно случится. Средняя — ручка
        для пальца, у неё же номер страницы.
      */}
      <div className="mt-1 flex items-center justify-between gap-0.5">
        <button
          type="button"
          data-testid="hw-page-move-left"
          onClick={() => onMove(-1)}
          onPointerDown={e => e.stopPropagation()}
          disabled={disabled || pageNumber === 1}
          aria-label={`Сдвинуть страницу ${pageNumber} влево`}
          title="Сдвинуть влево"
          className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft size={14} />
        </button>

        <span
          data-testid="hw-page-handle"
          onPointerDown={onPointerDownHandle}
          role="presentation"
          title="Потяните, чтобы переставить"
          // touch-action только здесь: если запретить прокрутку на всей
          // плитке, палец не сможет пролистнуть страницу с этого места.
          className="flex-1 cursor-grab touch-none select-none text-center text-xs tabular-nums text-gray-400 active:cursor-grabbing"
        >
          стр. {pageNumber}
        </span>

        <button
          type="button"
          data-testid="hw-page-move-right"
          onClick={() => onMove(1)}
          onPointerDown={e => e.stopPropagation()}
          disabled={disabled || pageNumber === total}
          aria-label={`Сдвинуть страницу ${pageNumber} вправо`}
          title="Сдвинуть вправо"
          className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
