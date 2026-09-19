import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ImportedRegion } from '@/components/SubmissionReviewer'
import { BookOpen, Eye, Loader2, Paperclip, Pencil, X } from 'lucide-react'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SolutionReferencePanel, useTopicSolutionMaterials } from './SolutionReferencePanel'
import { AttemptPdfButton, type AttemptPdfAudience } from './AttemptPdfButton'
import type { AttemptPdfReport } from '@/lib/attemptPdfReport'
import type { AttemptExportSnapshot } from '@/lib/attemptPdfSource'
import { cn } from '@/utils/cn'
import { FileChip } from '@/components/shared/FileChip'
import { viewersLabel, type PresenceMeta } from '@/lib/reviewPresence'
import {
  MAX_SOLUTION_FRACTION,
  MIN_SOLUTION_FRACTION,
  fractionFromPointer,
  fractionToPercent,
  readSolutionFraction,
  readStoredSolutionFraction,
  writeSolutionFraction,
} from '@/lib/reviewPaneLayout'
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
  lead,
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
  dedupeFramesRef,
  onDuplicateFramesChange,
  onMarksCleared,
  solutionTopicId,
  pdfAudience = 'staff',
  pdfReport,
  onClose,
}: {
  attemptId: string
  files: TopicHomeworkAttemptFileRow[]
  title: string
  /**
   * §208. Главная строка шапки — чья работа и по какой теме. Её передают
   * только преподавательские экраны: у ученика «чья работа» очевидно, и
   * крупной строкой там остаётся название задания (`title`).
   */
  lead?: string
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
  /** §207. Проброс к аннотатору: уборка точных повторов рамок по нажатию. */
  dedupeFramesRef?: MutableRefObject<(() => Promise<number>) | null>
  /** §207. Сколько сейчас точных повторов — кнопку рисует экран снаружи. */
  onDuplicateFramesChange?: (count: number) => void
  /** §156. После «Очистить пометки» — панель ИИ снаружи перечитывает находки. */
  onMarksCleared?: () => void
  /**
   * Тема, из которой брать решение задания для справочной панели.
   *
   * Проп передают ТОЛЬКО преподавательские экраны. Ученический
   * `TopicHomeworkStudent` его не передаёт, поэтому показать решение ученику
   * нечем даже по ошибке — это защита конструкцией, а не проверкой роли,
   * про которую легко забыть.
   */
  solutionTopicId?: string | null
  /**
   * §206. Кто скачивает работу. У ученика кнопка появляется только после
   * вердикта: до него он смотрит черновик проверки (правило §199).
   */
  pdfAudience?: AttemptPdfAudience
  /**
   * Данные для последней страницы файла: вердикт, балл, комментарий, таблица
   * по заданиям. Их знает экран снаружи, а не разбор. Нет данных — нет и
   * кнопки: файл без разбора обещал бы не то, что в нём лежит.
   */
  pdfReport?: AttemptPdfReport | null
  onClose: () => void
}) {
  const publishRef = useRef<((targetStatus?: 'checked' | 'revision') => Promise<boolean>) | null>(null)
  /** Заполняет аннотатор; читает кнопка «Скачать PDF» в момент нажатия. */
  const exportSourceRef = useRef<(() => AttemptExportSnapshot) | null>(null)
  // Мягкая защита = тот же режим чтения, что и обычный readOnly: рисовать
  // нельзя, вердикт не ставится. Разница только в баннере и кнопке выхода.
  const viewOnly = readOnly || locked
  const { annotatable, other } = useMemo(() => splitAnnotatableFiles(files), [files])
  const paths = useMemo(() => annotatable.map(f => f.storage_path), [annotatable])
  const [filesOpen, setFilesOpen] = useState(false)
  /** Мелкая строка шапки: всё, что не «чья работа и тема». */
  const headerSecondary = [lead ? title : null, subtitle].filter(Boolean).join(' · ')

  const { materials: solution, loading: solutionLoading } = useTopicSolutionMaterials(solutionTopicId)
  const hasSolution = solution.length > 0
  const [solutionOpen, setSolutionOpen] = useState(true)
  const showSolution = hasSolution && solutionOpen

  /**
   * Ширина панели решения — доля рабочей области, запомненная между разборами
   * (§140). Границу можно тянуть мышью и пальцем; арифметика в
   * `lib/reviewPaneLayout`, здесь только жест.
   */
  const splitRef = useRef<HTMLDivElement>(null)
  const [solutionFraction, setSolutionFraction] = useState(() => readSolutionFraction())
  /**
   * §208. Ширину уже выбирали руками — хоть сейчас, хоть в прошлый раз. Пока
   * не выбирали, между 1024 и 1536 панель остаётся фиксированной (§140):
   * доля в 40 % отдала бы документу ~436 px, и работать стало бы хуже, чем
   * было. После первого же движения границы действует выбор человека.
   */
  const [fractionChosen, setFractionChosen] = useState(() => readStoredSolutionFraction() != null)
  const [dragging, setDragging] = useState(false)

  function chooseFraction(next: number) {
    setSolutionFraction(next)
    setFractionChosen(true)
  }

  function moveSplit(clientX: number) {
    const rect = splitRef.current?.getBoundingClientRect()
    if (!rect) return
    chooseFraction(fractionFromPointer(clientX, rect))
  }

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
      {/*
        §208. Крупно — то, ради чего в шапку и смотрят: чья это работа и по
        какой теме (`lead`). Название задания и пометки вроде «сдано с
        опозданием» остаются, но мельче: их читают один раз. Экран ученика
        `lead` не передаёт — там главное как раз название работы, и оно
        остаётся крупной строкой.
      */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shrink-0">
        <div className="min-w-0">
          <h2 data-testid="attempt-header-lead" className="truncate text-base font-bold leading-tight text-gray-900 sm:text-lg">
            {lead ?? title}
          </h2>
          {headerSecondary && (
            <p data-testid="attempt-header-secondary" className="mt-0.5 truncate text-sm text-gray-500">
              {headerSecondary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            §208. Полоса со ссылками на файлы висела во всю ширину и показывала
            машинные имена вида `1789646586292_img_…webp` — читать их незачем.
            Убрана с глаз, но не удалена: через неё скачивают оригинал, и это
            единственный путь, когда встроенный просмотр не завёлся.
          */}
          {files.length > 0 && (
            <button
              type="button"
              data-testid="attempt-files-toggle"
              aria-expanded={filesOpen}
              onClick={() => setFilesOpen(v => !v)}
              title="Открыть оригиналы файлов работы"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                filesOpen
                  ? 'border-gray-300 bg-gray-100 text-gray-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800',
              )}
            >
              <Paperclip size={13} />
              Файлы ({files.length})
            </button>
          )}
          {paths.length > 0 && (
            <AttemptPdfButton audience={pdfAudience} report={pdfReport ?? null} sourceRef={exportSourceRef} />
          )}
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
        §208: полоса раскрывается кнопкой «Файлы (N)» в шапке, а не висит
        всегда — имена файлов машинные, и постоянно они не нужны никому.
      */}
      {files.length > 0 && filesOpen && (
        <div
          data-testid="attempt-files-strip"
          className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 shrink-0"
        >
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
                  'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-xs',
                  isOther
                    ? 'border-amber-300 text-amber-900 hover:border-amber-400'
                    : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-700',
                )}
              >
                <FileChip
                  name={f.file_name}
                  leading={<Paperclip size={11} className="shrink-0" />}
                  trailing={isOther && <span className="shrink-0 text-[10px] text-amber-700">без разметки</span>}
                />
              </SignedFileLink>
            )
          })}
        </div>
      )}

      {/* Решение слева, работа справа: сравнивать удобнее, когда оба на
          экране, а не в двух вкладках. На узком экране панель уезжает наверх —
          «сначала решение, потом фото» сохраняется и там. */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {showSolution && (
          <SolutionReferencePanel
            topicId={solutionTopicId ?? ''}
            materials={solution}
            loading={solutionLoading}
            widthPercent={fractionToPercent(solutionFraction)}
            widthFromLaptop={fractionChosen}
          />
        )}

        {/*
          Граница между эталоном и работой. §208: живёт с 1024, а не с 1536 —
          владелец работает на 1280–1440, и раньше подвинуть панель там было
          нечем. Ниже 1024 колонки идут друг под другом, делить нечего.
          Pointer Events — один обработчик на мышь и палец (урок §118), с
          клавиатуры граница двигается стрелками, потому что это ползунок и он
          обязан быть доступен без мыши.
        */}
        {showSolution && (
          <div
            data-testid="solution-split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ширина панели решения"
            aria-valuemin={Math.round(MIN_SOLUTION_FRACTION * 100)}
            aria-valuemax={Math.round(MAX_SOLUTION_FRACTION * 100)}
            aria-valuenow={Math.round(solutionFraction * 100)}
            tabIndex={0}
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
              setDragging(true)
            }}
            onPointerMove={e => { if (dragging) moveSplit(e.clientX) }}
            onPointerUp={() => {
              if (!dragging) return
              setDragging(false)
              writeSolutionFraction(solutionFraction)
            }}
            onPointerCancel={() => setDragging(false)}
            onKeyDown={e => {
              const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0
              if (!step) return
              e.preventDefault()
              const next = Math.min(
                MAX_SOLUTION_FRACTION,
                Math.max(MIN_SOLUTION_FRACTION, solutionFraction + step),
              )
              chooseFraction(next)
              writeSolutionFraction(next)
            }}
            className={cn(
              'hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-slate-200 transition-colors lg:block',
              'hover:bg-primary-300 focus-visible:bg-primary-400 focus-visible:outline-none',
              dragging && 'bg-primary-400',
            )}
          />
        )}

        {/* §190. На телефоне боком (низкий широкий экран) поля вокруг разбора
            съедают 24 из 370 пикселей высоты, а их там и без того не хватает —
            убираем ровно в этом случае. Условие то же, что у раскладки разбора
            в SubmissionReviewer; на компьютере и на вертикальном телефоне поля
            прежние. */}
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4 [@media(min-width:700px)_and_(max-height:600px)]:p-0">
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
              dedupeFramesRef={dedupeFramesRef}
              onDuplicateFramesChange={onDuplicateFramesChange}
              onMarksCleared={onMarksCleared}
              exportSourceRef={exportSourceRef}
            />
          </Suspense>
        )}
        </div>
      </div>
    </div>
  )
}
