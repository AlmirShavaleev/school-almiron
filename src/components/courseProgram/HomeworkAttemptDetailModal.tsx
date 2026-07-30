import { useEffect, useState } from 'react'
import { X, Loader2, AlertCircle, Paperclip, SquareDashed } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getSignedFileUrl } from '@/lib/storage'
import { AttemptAnnotationOverlay, splitAnnotatableFiles } from './AttemptAnnotationOverlay'
import {
  ATTEMPT_STATUS_TONE,
  TEACHER_ATTEMPT_STATUS_LABEL,
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  attemptsNewestFirst,
  gradeScaleMax,
  latestReview,
  type GradeScale,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkReviewRow,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Один файл попытки: картинка — сразу превью (сигнатура подписывается один
 * раз при монтировании, не дожидаясь клика — иначе владелец увидел бы
 * плейсхолдер вместо фото), остальное — плашка-ссылка как в очереди проверки
 * (TopicHomeworkReview.AttemptFiles).
 *
 * Клик по файлу, который можно разметить (PDF/картинка), открывает
 * аннотатор — рамки с указанием ошибок. Файл, который разметить нельзя,
 * по-прежнему открывается в новой вкладке.
 */
function AttemptFilePreview({
  file,
  onAnnotate,
}: {
  file: TopicHomeworkAttemptFileRow
  onAnnotate?: () => void
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const isImage = (file.mime_type || '').startsWith('image/')

  useEffect(() => {
    let cancelled = false
    getSignedFileUrl(TOPIC_HOMEWORK_ATTEMPTS_BUCKET, file.storage_path)
      .then(url => {
        if (!cancelled) setSignedUrl(url)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file.storage_path])

  if (isImage) {
    const thumb = loading ? (
      <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
        <Loader2 size={16} className="animate-spin text-gray-300" />
      </div>
    ) : signedUrl ? (
      <img
        src={signedUrl}
        alt={file.file_name}
        className="h-28 w-28 rounded-lg border border-gray-200 object-cover transition-opacity hover:opacity-90"
      />
    ) : (
      <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-center text-xs text-gray-400">
        Не удалось открыть
      </div>
    )

    if (onAnnotate) {
      return (
        <button
          type="button"
          data-testid="attempt-file-annotate"
          onClick={onAnnotate}
          title={`${file.file_name} — открыть с разметкой`}
          className="block shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          {thumb}
        </button>
      )
    }

    return (
      <a
        href={signedUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('block shrink-0', !signedUrl && 'pointer-events-none')}
        title={file.file_name}
      >
        {thumb}
      </a>
    )
  }

  if (onAnnotate) {
    return (
      <button
        type="button"
        data-testid="attempt-file-annotate"
        onClick={onAnnotate}
        title={`${file.file_name} — открыть с разметкой`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-primary-600 hover:border-primary-300 hover:underline"
      >
        <Paperclip size={12} />
        {file.file_name}
      </button>
    )
  }

  return (
    <a
      href={signedUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-busy={loading}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-primary-600 hover:border-primary-300 hover:underline shrink-0',
        !signedUrl && 'pointer-events-none opacity-60',
      )}
    >
      <Paperclip size={12} />
      {file.file_name}
    </a>
  )
}

/**
 * Работы ученика по конкретному ДЗ темы — открывается кликом по строке
 * ученика в аккордеоне «Домашние задания» (CourseTopicHomeworkSection).
 * Читает то же, что и общая очередь проверки (useHomeworkReviewQueue), но
 * точечно — по одному ученику и одному ДЗ, без вердикта (проверка живёт
 * только в /homework-queue, см. §14/§16 PROJECT_STATE — блок «Работы
 * учеников» из редактора темы убран сознательно).
 */
export function HomeworkAttemptDetailModal({
  homeworkId,
  studentId,
  studentName,
  homeworkTitle,
  gradeScale,
  onClose,
}: {
  homeworkId: string
  studentId: string
  studentName: string
  homeworkTitle: string
  gradeScale: GradeScale | null
  onClose: () => void
}) {
  const [attempts, setAttempts] = useState<TopicHomeworkAttemptRow[]>([])
  const [files, setFiles] = useState<TopicHomeworkAttemptFileRow[]>([])
  const [reviews, setReviews] = useState<TopicHomeworkReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState<TopicHomeworkAttemptRow | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const attemptsRes = await supabase
          .from('topic_homework_attempts')
          .select('*')
          .eq('homework_id', homeworkId)
          .eq('student_id', studentId)
          .order('attempt_number', { ascending: false })

        if (attemptsRes.error) throw new Error(attemptsRes.error.message)
        const attemptRows = (attemptsRes.data ?? []) as TopicHomeworkAttemptRow[]
        const attemptIds = attemptRows.map(a => a.id)

        const [filesRes, reviewsRes] = attemptIds.length > 0
          ? await Promise.all([
              supabase.from('topic_homework_attempt_files').select('*').in('attempt_id', attemptIds).order('position'),
              supabase.from('topic_homework_reviews').select('*').in('attempt_id', attemptIds).order('created_at'),
            ])
          : [{ data: [] as any[], error: null }, { data: [] as any[], error: null }]

        if (filesRes.error) throw new Error(filesRes.error.message)
        if (reviewsRes.error) throw new Error(reviewsRes.error.message)

        if (!cancelled) {
          setAttempts(attemptsNewestFirst(attemptRows))
          setFiles((filesRes.data ?? []) as TopicHomeworkAttemptFileRow[])
          setReviews((reviewsRes.data ?? []) as TopicHomeworkReviewRow[])
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Не удалось загрузить работы ученика')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [homeworkId, studentId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Пока открыт аннотатор, Esc закрывает его, а не всю модалку —
      // иначе одно нажатие схлопнуло бы оба слоя разом.
      if (e.key === 'Escape' && !annotating) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [annotating, onClose])

  const scoreMax = gradeScaleMax(gradeScale)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        data-testid="homework-attempt-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Работа «${homeworkTitle}» — ${studentName}`}
        className="relative bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-[92vh] flex flex-col z-10 overflow-hidden"
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 leading-tight truncate">{homeworkTitle}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{studentName}</p>
          </div>
          <button
            data-testid="homework-attempt-close"
            aria-label="Закрыть"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0 p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />
              Загрузка…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex gap-2">
                <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && (
            attempts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Ученик ещё не сдавал эту работу</p>
            ) : (
              <div className="space-y-4">
                {attempts.map(attempt => {
                  const attemptFiles = files.filter(f => f.attempt_id === attempt.id)
                  const review = latestReview(reviews, attempt.id)

                  return (
                    <div key={attempt.id} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">Попытка №{attempt.attempt_number}</span>
                        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[attempt.status])}>
                          {TEACHER_ATTEMPT_STATUS_LABEL[attempt.status]}
                        </span>
                        {formatDate(attempt.submitted_at) && (
                          <span className="text-xs text-gray-400">{formatDate(attempt.submitted_at)}</span>
                        )}
                      </div>

                      {attemptFiles.length === 0 ? (
                        <p className="text-xs text-gray-400">Файлов нет</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {attemptFiles.map(f => (
                              <AttemptFilePreview
                                key={f.id}
                                file={f}
                                onAnnotate={
                                  splitAnnotatableFiles([f]).annotatable.length > 0
                                    ? () => setAnnotating(attempt)
                                    : undefined
                                }
                              />
                            ))}
                          </div>
                          {splitAnnotatableFiles(attemptFiles).annotatable.length > 0 && (
                            <button
                              type="button"
                              data-testid="attempt-annotate-button"
                              onClick={() => setAnnotating(attempt)}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:border-primary-300"
                            >
                              <SquareDashed size={12} />
                              Указать ошибки рамками
                            </button>
                          )}
                        </>
                      )}

                      {review?.comment && (
                        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                          {review.comment}
                        </p>
                      )}

                      {attempt.status === 'accepted' && review?.score != null && scoreMax != null && (
                        <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                          Оценка: {review.score}/{scoreMax}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>

      {annotating && (
        <AttemptAnnotationOverlay
          attemptId={annotating.id}
          files={files.filter(f => f.attempt_id === annotating.id)}
          title={homeworkTitle}
          subtitle={`${studentName} · попытка №${annotating.attempt_number}`}
          footerPublishLabel="Опубликовать пометки ученику"
          footer={() => (
            <p className="text-xs text-gray-500">
              Рамки сохраняются сразу, но ученик увидит их только после публикации.
              Оценку и вердикт ставят в «Проверке домашних заданий».
            </p>
          )}
          onClose={() => setAnnotating(null)}
        />
      )}
    </div>
  )
}
