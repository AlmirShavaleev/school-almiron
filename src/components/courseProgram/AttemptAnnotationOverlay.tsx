import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ImportedRegion } from '@/components/SubmissionReviewer'
import { BookOpen, Eye, Loader2, Paperclip, Pencil, X } from 'lucide-react'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SolutionReferencePanel, useTopicSolutionMaterials } from './SolutionReferencePanel'
import { cn } from '@/utils/cn'
import { viewersLabel, type PresenceMeta } from '@/lib/reviewPresence'
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

/**
 * Полоса «работу смотрит кто-то ещё».
 *
 * Два разных случая, и их важно не смешивать:
 *  - `locked` — при открытии внутри УЖЕ кто-то был, поэтому вход только на
 *    чтение. Выход есть: «Всё равно редактировать» — осознанное решение, а не
 *    запертая навсегда работа.
 *  - иначе — коллега зашёл ПОСЛЕ вас. Выгонять на чтение поздно (можно затереть
 *    начатое), поэтому просто предупреждаем.
 */
function PresenceBanner({
  viewers,
  locked,
  onForceEdit,
}: {
  viewers: PresenceMeta[]
  locked: boolean
  onForceEdit?: () => void
}) {
  if (viewers.length === 0) return null
  const label = viewersLabel(viewers)

  if (!locked) {
    return (
      <div
        data-testid="presence-banner-warning"
        className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 shrink-0"
      >
        <Eye size={13} className="shrink-0" />
        <span>{label}. Правки могут перекрыть друг друга — лучше договориться, кто проверяет.</span>
      </div>
    )
  }

  return (
    <div
      data-testid="presence-banner-locked"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 shrink-0"
    >
      <span className="inline-flex items-center gap-1.5">
        <Eye size={13} className="shrink-0" />
        {label}. Открыто только для чтения, чтобы не затереть чужие пометки.
      </span>
      {onForceEdit && (
        <button
          type="button"
          data-testid="presence-force-edit"
          onClick={onForceEdit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 transition-colors hover:border-amber-400 hover:bg-amber-100"
        >
          <Pencil size={12} />
          Всё равно редактировать
        </button>
      )}
    </div>
  )
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
  viewers = [],
  locked = false,
  onForceEdit,
  footer,
  footerPublishLabel,
  publishButtonLabel = 'Опубликовать пометки',
  hideToolbarPublish = false,
  importRegionsRef,
  solutionTopicId,
  onClose,
}: {
  attemptId: string
  files: TopicHomeworkAttemptFileRow[]
  title: string
  subtitle?: string
  readOnly?: boolean
  /** Кто ещё сейчас в этой работе (из Supabase Presence). */
  viewers?: PresenceMeta[]
  /**
   * При открытии внутри уже кто-то был — входим на чтение. Решение снимается
   * один раз, в момент открытия: выкидывать из редактирования того, кто уже
   * рисует, потому что зашёл второй, было бы хуже самой проблемы.
   */
  locked?: boolean
  onForceEdit?: () => void
  footer?: AttemptAnnotationFooter
  footerPublishLabel?: string
  publishButtonLabel?: string
  hideToolbarPublish?: boolean
  /** Проброс к аннотатору: через него панель черновика ИИ переносит рамки. */
  importRegionsRef?: MutableRefObject<((regions: ImportedRegion[]) => Promise<number>) | null>
  /**
   * Тема, из которой брать решение задания для справочной панели.
   *
   * Проп передают ТОЛЬКО преподавательские экраны. Ученический
   * `TopicHomeworkStudent` его не передаёт, поэтому показать решение ученику
   * нечем даже по ошибке — это защита конструкцией, а не проверкой роли,
   * про которую легко забыть.
   */
  solutionTopicId?: string | null
  onClose: () => void
}) {
  const publishRef = useRef<((targetStatus?: 'checked' | 'revision') => Promise<boolean>) | null>(null)
  // Мягкая защита = тот же режим чтения, что и обычный readOnly: рисовать
  // нельзя, вердикт не ставится. Разница только в баннере и кнопке выхода.
  const viewOnly = readOnly || locked
  const { annotatable, other } = useMemo(() => splitAnnotatableFiles(files), [files])
  const paths = useMemo(() => annotatable.map(f => f.storage_path), [annotatable])

  const { materials: solution, loading: solutionLoading } = useTopicSolutionMaterials(solutionTopicId)
  const hasSolution = solution.length > 0
  const [solutionOpen, setSolutionOpen] = useState(true)
  const showSolution = hasSolution && solutionOpen

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
        <div className="flex shrink-0 items-center gap-2">
          {hasSolution && (
            <button
              type="button"
              data-testid="attempt-solution-toggle"
              aria-pressed={solutionOpen}
              onClick={() => setSolutionOpen(v => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                solutionOpen
                  ? 'border-primary-300 bg-primary-50 text-primary-800'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900',
              )}
            >
              <BookOpen size={13} />
              Решение
            </button>
          )}
          <button
            type="button"
            data-testid="attempt-annotation-close"
            aria-label="Закрыть разбор"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <PresenceBanner viewers={viewers} locked={locked} onForceEdit={onForceEdit} />

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

      {/* Решение слева, работа справа: сравнивать удобнее, когда оба на
          экране, а не в двух вкладках. На узком экране панель уезжает наверх —
          «сначала решение, потом фото» сохраняется и там. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showSolution && (
          <SolutionReferencePanel
            topicId={solutionTopicId ?? ''}
            materials={solution}
            loading={solutionLoading}
          />
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
            {!viewOnly && footer && (
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
              readOnly={viewOnly}
              // В режиме чтения аннотатор по умолчанию показывает только
              // опубликованные пометки. Здесь это было бы вредно: второй
              // проверяющий пришёл посмотреть ровно то, что коллега рисует
              // прямо сейчас, — а оно ещё в черновике.
              annotationVisibility={locked ? 'all' : undefined}
              className="h-full min-h-0"
              footer={footerContent}
              footerPublishLabel={footerPublishLabel}
              publishButtonLabel={publishButtonLabel}
              hideToolbarPublish={hideToolbarPublish}
              publishRef={publishRef}
              importRegionsRef={importRegionsRef}
            />
          </Suspense>
        )}
        </div>
      </div>
    </div>
  )
}
