import { Suspense, lazy, useEffect, useMemo, useRef } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { cn } from '@/utils/cn'
import {
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  type TopicHomeworkAttemptFileRow,
} from '@/lib/topicHomework'

const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))

/**
 * Аннотатор весит ~450 КБ (pdfjs), поэтому грузится лениво — не тянем его
 * в бандл всем, кто просто открыл курс.
 */
function ReviewerFallback() {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center text-sm text-slate-500">
      <Loader2 size={18} className="mr-2 animate-spin" />
      Загрузка редактора…
    </div>
  )
}

/**
 * Аннотатор умеет рисовать только PDF и картинки. Остальное (docx, zip и
 * прочее, что ученик мог приложить) показываем отдельным списком ссылок —
 * молча прятать файл работы нельзя, преподаватель должен знать, что он есть.
 */
const ANNOTATABLE = /\.(pdf|png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i

export function splitAnnotatableFiles(files: TopicHomeworkAttemptFileRow[]) {
  const annotatable: TopicHomeworkAttemptFileRow[] = []
  const other: TopicHomeworkAttemptFileRow[] = []
  for (const f of files) {
    const byMime = (f.mime_type || '').startsWith('image/') || f.mime_type === 'application/pdf'
    if (byMime || ANNOTATABLE.test(f.storage_path)) annotatable.push(f)
    else other.push(f)
  }
  return { annotatable, other }
}

export type AttemptAnnotationFooter = (context: {
  publishing: boolean
  published: boolean
  /** Публикует рамки (draft → published) и возвращает, удалось ли. */
  publishAnnotations: (targetStatus?: 'checked' | 'revision') => Promise<boolean>
}) => React.ReactNode

/**
 * Полноэкранный разбор работы ученика: фото/PDF с рамками поверх.
 * Одна и та же вьюха и для модалки аккордеона курса
 * (HomeworkAttemptDetailModal), и для «Очереди проверок ДЗ»
 * (HomeworkReviewQueuePage) — разница только в футере: там подпись+кнопка
 * публикации пометок, тут полная форма вердикта.
 */
export function AttemptAnnotationOverlay({
  attemptId,
  files,
  title,
  subtitle,
  readOnly = false,
  footer,
  footerPublishLabel,
  publishButtonLabel = 'Опубликовать пометки',
  hideToolbarPublish = false,
  onClose,
}: {
  attemptId: string
  files: TopicHomeworkAttemptFileRow[]
  title: string
  subtitle?: string
  readOnly?: boolean
  footer?: AttemptAnnotationFooter
  footerPublishLabel?: string
  publishButtonLabel?: string
  hideToolbarPublish?: boolean
  onClose: () => void
}) {
  const publishRef = useRef<((targetStatus?: 'checked' | 'revision') => Promise<boolean>) | null>(null)
  const { annotatable, other } = useMemo(() => splitAnnotatableFiles(files), [files])
  const paths = useMemo(() => annotatable.map(f => f.storage_path), [annotatable])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Пробрасываем публикацию наружу через ref: сам аннотатор выставит его
  // в publishRef.current, а футер вызовет уже через эту обёртку.
  const publishAnnotations = async (targetStatus?: 'checked' | 'revision') => {
    const fn = publishRef.current
    if (!fn) return false
    return fn(targetStatus)
  }

  const footerContent = footer
    ? ({ publishing, published }: { publishing: boolean; published: boolean }) =>
        footer({ publishing, published, publishAnnotations })
    : undefined

  return (
    <div
      data-testid="attempt-annotation-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Разбор работы: ${title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-slate-100"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shrink-0">
        <div className="min-w-0">
          <h2 className="truncate font-bold text-gray-900 leading-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>}
        </div>
        <button
          type="button"
          data-testid="attempt-annotation-close"
          aria-label="Закрыть разбор"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X size={20} />
        </button>
      </div>

      {/*
        Полоса со ВСЕМИ файлами работы, а не только с неразмечаемыми.
        Так у преподавателя всегда есть способ открыть оригинал — это важно,
        когда встроенный просмотр не завёлся (например, браузер не смог
        подгрузить движок PDF). Неразмечаемые помечены отдельно.
      */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 shrink-0">
          <span className="text-xs text-gray-500">Файлы работы:</span>
          {[...annotatable, ...other].map(f => {
            const isOther = other.some(o => o.id === f.id)
            return (
              <SignedFileLink
                key={f.id}
                bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
                url={f.storage_path}
                title={isOther ? 'Этот файл нельзя разметить — откроется отдельно' : 'Открыть оригинал в новой вкладке'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-xs',
                  isOther
                    ? 'border-amber-300 text-amber-900 hover:border-amber-400'
                    : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-700',
                )}
              >
                <Paperclip size={11} />
                {f.file_name}
                {isOther && <span className="text-[10px] text-amber-700">без разметки</span>}
              </SignedFileLink>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {paths.length === 0 ? (
          // Размечать нечего (только .docx, .zip и т.п. или файлов нет вовсе),
          // но вердикт поставить всё равно нужно — иначе такая работа осталась
          // бы в очереди навсегда. Поэтому футер рисуем и здесь, а публиковать
          // нечего: publishAnnotations сразу отвечает «успешно».
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center text-sm text-gray-400">
              {files.length === 0
                ? 'В этой попытке нет файлов — размечать нечего'
                : 'Ни один файл этой попытки нельзя разметить (нужен PDF или картинка)'}
            </div>
            {!readOnly && footer && (
              <div className="rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,.14)] outline outline-1 outline-black/10 sm:p-5">
                {footer({ publishing: false, published: false, publishAnnotations: async () => true })}
              </div>
            )}
          </div>
        ) : (
          <Suspense fallback={<ReviewerFallback />}>
            <SubmissionReviewer
              attemptId={attemptId}
              bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
              filePath={paths[0]}
              filePaths={paths}
              readOnly={readOnly}
              className="h-full min-h-0"
              footer={footerContent}
              footerPublishLabel={footerPublishLabel}
              publishButtonLabel={publishButtonLabel}
              hideToolbarPublish={hideToolbarPublish}
              publishRef={publishRef}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}
