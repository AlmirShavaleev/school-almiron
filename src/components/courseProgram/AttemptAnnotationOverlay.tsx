import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type {
  AttemptNotesApi, AttemptNotesSnapshot, ImportedRegion,
} from '@/components/SubmissionReviewer'
import { BookOpen, Eye, Loader2, Paperclip, Pencil, X } from 'lucide-react'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SolutionReferenceBlock, SolutionReferencePanel, useTopicSolutionMaterials } from './SolutionReferencePanel'
import type { ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'
import { AttemptPdfButton, type AttemptPdfAudience } from './AttemptPdfButton'
import type { AttemptPdfReport } from '@/lib/attemptPdfReport'
import type { AttemptExportSnapshot } from '@/lib/attemptPdfSource'
import { cn } from '@/utils/cn'
import { FileChip } from '@/components/shared/FileChip'
import { viewersLabel, type PresenceMeta } from '@/lib/reviewPresence'
import {
  MAX_SOLUTION_FRACTION,
  MAX_TABLE_FRACTION,
  MIN_SOLUTION_FRACTION,
  MIN_TABLE_FRACTION,
  clampTableFraction,
  fractionFromPointer,
  fractionToPercent,
  readSolutionFraction,
  readStoredSolutionFraction,
  readTableFraction,
  solutionShareOf,
  tableFractionFromPointer,
  tableFractionToPercent,
  writeSolutionFraction,
  writeTableFraction,
} from '@/lib/reviewPaneLayout'
import {
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  type TopicHomeworkAttemptFileRow,
} from '@/lib/topicHomework'

const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))

/** §226. Ключ «эталон в колонке заданий открыт». */
export const REFERENCE_OPEN_STORAGE_KEY = 'review:reference-open'

function readReferenceOpen(): boolean {
  try {
    return window.localStorage.getItem(REFERENCE_OPEN_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function writeReferenceOpen(open: boolean) {
  try {
    window.localStorage.setItem(REFERENCE_OPEN_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Хранилища нет (приватное окно) — просто не запомним.
  }
}

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
 * §210. Третья колонка справа: таблица проверки и форма вердикта.
 *
 * Отдельный проп, а не `footer`, ровно потому, что это не футер: содержимое
 * стоит РЯДОМ с работой, а не под ней, и своего свитка работы не делит.
 * `publishing`/`published` сюда не передаются намеренно — они живут внутри
 * аннотатора, а колонке нужна только сама публикация, которую она зовёт из
 * обработчика вердикта.
 */
export type AttemptReviewPanel = (context: {
  publishAnnotations: (targetStatus?: 'checked' | 'revision') => Promise<boolean>
  /**
   * §226. Эталон — сворачиваемый блок «авторское решение целиком». Колонки
   * решения слева на экране проверки больше нет: блок кладёт в колонку
   * заданий тот, кто её рисует. `null` — решения у темы нет.
   */
  reference?: React.ReactNode
  /** §226. Раскрыть блок эталона и докрутить до него. */
  showReference?: (() => void) | null
}) => React.ReactNode

/**
 * Полноэкранный разбор работы ученика: фото/PDF с рамками поверх.
 * Одна и та же вьюха и для модалки аккордеона курса
 * (HomeworkAttemptDetailModal), и для «Очереди проверок ДЗ»
 * (HomeworkReviewQueuePage), и для ученика (TopicHomeworkStudent).
 *
 * Разница — в том, что каждый экран передаёт рядом с работой:
 *  - модалка аккордеона: `footer` — подпись и кнопка публикации пометок,
 *    одна строка под работой, колонки она не стоит;
 *  - очередь проверок: `reviewPanel` — таблица проверки и форма вердикта
 *    ТРЕТЬЕЙ колонкой справа (§210), со своим свитком;
 *  - ученик: ни того, ни другого — у него разбор, и колонок остаётся две.
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
  reviewPanel,
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
  notesInTaskList = false,
  notesApiRef,
  onNotesChange,
  onSelectedNoteChange,
  backLabel,
  headerAside,
  reviewBar,
  taskVerdicts,
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
  /**
   * §210. Третья колонка. Передаёт только экран проверки: у ученика и в
   * «Пометках учителя» класть в неё нечего, и там колонок остаётся столько
   * же, сколько было.
   */
  reviewPanel?: AttemptReviewPanel
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
  /**
   * §209. Замечания показывает таблица заданий снаружи — колонку
   * «Комментарии» внутри разбора тогда не рисуем. Передаёт только экран
   * проверки: в «Пометках учителя» и в «Указать ошибки рамками» таблицы рядом
   * нет, и без списка замечания стали бы невидимы.
   */
  notesInTaskList?: boolean
  notesApiRef?: MutableRefObject<AttemptNotesApi | null>
  onNotesChange?: (snapshot: AttemptNotesSnapshot) => void
  onSelectedNoteChange?: (id: string | null) => void
  /**
   * §226. Экран проверки v2 (включается `reviewPanel`): строка «← Очередь
   * проверки · 1 из 39» над именем. Нажатие закрывает разбор — возвращает в
   * очередь, откуда пришли.
   */
  backLabel?: string
  /** §226. Правая часть шапки: сводка вердиктов и «Следующая работа». */
  headerAside?: React.ReactNode
  /**
   * §226. Нижняя строка во всю ширину: балл, комментарий, «Вернуть», «Принять».
   * Та же форма вердикта, что раньше стояла в третьей колонке под таблицей.
   */
  reviewBar?: AttemptReviewPanel
  /** §226. Вердикты заданий — рамки на фото красятся ими и подписываются номером. */
  taskVerdicts?: Readonly<Record<string, ReviewTaskVerdict>> | null
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
  /**
   * §226. Экран проверки v2: шапка с именем и сводкой, фото на большую часть
   * ширины, справа задания, внизу одна строка решения. Включается тем же, что
   * и раньше включало третью колонку, — `reviewPanel` передаёт только экран
   * проверки. Ученик и «Пометки учителя» живут в прежней раскладке. Колонки
   * решения слева в v2 нет — эталон уходит блоком в колонку заданий.
   */
  const reviewMode = Boolean(reviewPanel)
  const [solutionOpen, setSolutionOpen] = useState(true)
  const showSolution = hasSolution && solutionOpen && !reviewMode

  /**
   * §226. Блок эталона в колонке заданий — открыт или свёрнут. Запоминается
   * в браузере проверяющего (удобство, не данные): кто свернул его однажды,
   * тому он мешает и в следующей работе. Хранилища может не быть — тогда
   * открыт, как было с колонкой решения.
   */
  const [referenceOpen, setReferenceOpen] = useState(() => readReferenceOpen())
  const referenceRef = useRef<HTMLElement | null>(null)
  function chooseReferenceOpen(next: boolean) {
    setReferenceOpen(next)
    writeReferenceOpen(next)
  }
  function showReference() {
    chooseReferenceOpen(true)
    // После отрисовки: раскрытый блок выше, чем свёрнутый.
    window.requestAnimationFrame(() => {
      referenceRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    })
  }

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

  /**
   * §210. Третья колонка — только когда есть что в неё положить и когда её
   * содержимое вообще имеет смысл. В режиме чтения (свой `readOnly` или чужое
   * присутствие) вердикт не ставится, и пустая колонка отняла бы у работы
   * треть экрана ни за что — ровно как и раньше не рисовался футер.
   */
  const showReviewPanel = Boolean(reviewPanel) && !viewOnly

  /** Ширина третьей колонки — своя доля, со своей памятью (§210). */
  const [tableFraction, setTableFraction] = useState(() => readTableFraction())
  const [tableDragging, setTableDragging] = useState(false)

  /**
   * Сколько рабочей области занимает решение прямо сейчас. Вторая граница
   * обязана это знать: иначе она разрешила бы таблице ширину, которой на
   * экране нет, и работа схлопнулась бы в щель.
   */
  function currentSolutionShare(areaWidth: number) {
    return solutionShareOf({
      shown: showSolution, fraction: solutionFraction, chosen: fractionChosen, areaWidth,
    })
  }

  function chooseFraction(next: number) {
    setSolutionFraction(next)
    setFractionChosen(true)
  }

  function moveSplit(clientX: number) {
    const rect = splitRef.current?.getBoundingClientRect()
    if (!rect) return
    chooseFraction(fractionFromPointer(clientX, rect))
  }

  function moveTableSplit(clientX: number) {
    const rect = splitRef.current?.getBoundingClientRect()
    if (!rect) return
    setTableFraction(tableFractionFromPointer(clientX, rect, currentSolutionShare(rect.width)))
  }

  function stepTableSplit(step: number) {
    const width = splitRef.current?.getBoundingClientRect().width ?? 0
    const next = clampTableFraction(tableFraction + step, currentSolutionShare(width))
    setTableFraction(next)
    writeTableFraction(next)
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


  /**
   * Полоса со ВСЕМИ файлами работы, а не только с неразмечаемыми.
   * Так у преподавателя всегда есть способ открыть оригинал — это важно,
   * когда встроенный просмотр не завёлся (например, браузер не смог
   * подгрузить движок PDF). Неразмечаемые помечены отдельно.
   * §208: полоса раскрывается кнопкой «Файлы (N)» в шапке, а не висит
   * всегда — имена файлов машинные, и постоянно они не нужны никому.
   */
  const filesStrip = files.length > 0 && filesOpen ? (
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
      ) : null

  const footerContent = footer
    ? ({ publishing, published }: { publishing: boolean; published: boolean }) =>
        footer({ publishing, published, publishAnnotations })
    : undefined

  /** Сама работа — одинаково в обеих раскладках; на экране проверки v2 — с вкладками и рамками по вердиктам (§226). */
  const workContent = (paths.length === 0 ? (
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
              notesInTaskList={notesInTaskList}
              notesApiRef={notesApiRef}
              onNotesChange={onNotesChange}
              onSelectedNoteChange={onSelectedNoteChange}
              pageTabs={reviewMode}
              taskVerdicts={reviewMode ? taskVerdicts : null}
            />
          </Suspense>
        ))


  if (reviewMode) {
    const secondary = subtitle ?? (lead ? title : null)
    const reference = hasSolution ? (
      <SolutionReferenceBlock
        topicId={solutionTopicId ?? ''}
        materials={solution}
        loading={solutionLoading}
        open={referenceOpen}
        onToggle={() => chooseReferenceOpen(!referenceOpen)}
        blockRef={referenceRef}
      />
    ) : null
    const context = { publishAnnotations, reference, showReference: hasSolution ? showReference : null }
    return (
      <div
        data-testid="attempt-annotation-overlay"
        data-layout="review"
        role="dialog"
        aria-modal="true"
        aria-label={`Разбор работы: ${title}`}
        // §226. На телефоне прокручивается весь экран: шапка уезжает вверх,
        // строка решения прилипает к низу. С 1024 — колонки со своими
        // свитками, сам экран не прокручивается.
        className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-graphite-50 lg:overflow-hidden"
      >
        {/*
          §226. Шапка: сверху «← Очередь проверки · N из M» и тихие действия,
          ниже крупно «Имя — ДЗ» со строкой подробностей; справа от них (на
          телефоне — под ними) «Следующая работа» и сводка вердиктов.
        */}
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 gap-y-1.5 border-b border-graphite-200 bg-white px-4 py-3 lg:px-7 lg:py-4">
          <div className="col-start-1 row-start-1 min-w-0 self-center">
            {backLabel && (
              <button
                type="button"
                data-testid="attempt-back"
                onClick={onClose}
                className="text-[13px] text-graphite-500 transition-colors hover:text-graphite-900"
              >
                ← {backLabel}
              </button>
            )}
          </div>
          {/*
            Тихие действия над работой целиком: оригиналы файлов (§208),
            «Скачать PDF» (§206) и «Закрыть». В макете их нет — на экране
            они нужны редко, но убирать их нельзя.
          */}
          <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 self-center">
            {files.length > 0 && (
              <button
                type="button"
                data-testid="attempt-files-toggle"
                aria-expanded={filesOpen}
                onClick={() => setFilesOpen(v => !v)}
                title="Открыть оригиналы файлов работы"
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors',
                  filesOpen ? 'bg-graphite-100 text-graphite-900' : 'text-graphite-500 hover:bg-graphite-100 hover:text-graphite-900',
                )}
              >
                <Paperclip size={13} />
                <span className="hidden sm:inline">Файлы</span> ({files.length})
              </button>
            )}
            {paths.length > 0 && (
              <AttemptPdfButton audience={pdfAudience} report={pdfReport ?? null} sourceRef={exportSourceRef} quiet />
            )}
            <button
              type="button"
              data-testid="attempt-annotation-close"
              aria-label="Закрыть разбор"
              onClick={onClose}
              className="rounded-full p-1.5 text-graphite-400 transition-colors hover:bg-graphite-100 hover:text-graphite-900"
            >
              <X size={20} />
            </button>
          </div>
          <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1">
            <h2 data-testid="attempt-header-lead" className="line-clamp-2 text-lg font-semibold leading-tight text-graphite-900 lg:truncate lg:text-2xl">
              {lead ?? title}
            </h2>
            {secondary && (
              <p data-testid="attempt-header-secondary" title={secondary} className="mt-1 line-clamp-2 text-[13px] text-graphite-500">
                {secondary}
              </p>
            )}
          </div>
          {headerAside && (
            <div data-testid="attempt-header-aside" className="col-span-2 row-start-3 lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:justify-self-end">
              {headerAside}
            </div>
          )}
        </header>

        <PresenceBanner viewers={viewers} locked={locked} onForceEdit={onForceEdit} />
        {filesStrip}

        {/*
          Фото слева на всю оставшуюся ширину, задания справа своей колонкой со
          своим свитком (§210 — колесо в списке не уводит работу). Ниже 1024
          всё идёт одной лентой: фото, потом задания; строка решения остаётся
          внизу экрана — она вне ленты.
        */}
        <div
          ref={splitRef}
          data-testid="attempt-split-row"
          className="flex shrink-0 flex-col lg:min-h-0 lg:flex-1 lg:shrink lg:flex-row lg:overflow-hidden"
        >
          <div
            data-testid="attempt-work-column"
            className="h-[62vh] min-h-0 shrink-0 overflow-auto p-3 lg:h-auto lg:flex-1 lg:shrink lg:py-4 lg:pl-7 lg:pr-5"
          >
            {workContent}
          </div>

          {showReviewPanel && (
            <div
              data-testid="review-split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Ширина колонки заданий"
              aria-valuemin={Math.round(MIN_TABLE_FRACTION * 100)}
              aria-valuemax={Math.round(MAX_TABLE_FRACTION * 100)}
              aria-valuenow={Math.round(tableFraction * 100)}
              tabIndex={0}
              onPointerDown={e => {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                setTableDragging(true)
              }}
              onPointerMove={e => { if (tableDragging) moveTableSplit(e.clientX) }}
              onPointerUp={() => {
                if (!tableDragging) return
                setTableDragging(false)
                writeTableFraction(tableFraction)
              }}
              onPointerCancel={() => setTableDragging(false)}
              onKeyDown={e => {
                const step = e.key === 'ArrowLeft' ? 0.02 : e.key === 'ArrowRight' ? -0.02 : 0
                if (!step) return
                e.preventDefault()
                stepTableSplit(step)
              }}
              className={cn(
                'hidden w-1 shrink-0 cursor-col-resize touch-none bg-graphite-200 transition-colors lg:block',
                'hover:bg-primary-300 focus-visible:bg-primary-400 focus-visible:outline-none',
                tableDragging && 'bg-primary-400',
              )}
            />
          )}

          {showReviewPanel ? (
            <aside
              data-testid="review-side-column"
              style={{ ['--review-side-w' as string]: tableFractionToPercent(tableFraction) }}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-graphite-200 bg-white lg:h-full lg:w-[var(--review-side-w,37%)] lg:border-t-0"
            >
              <div
                data-testid="review-side-scroll-area"
                className="flex min-h-0 flex-col p-3 sm:p-4 lg:flex-1 lg:overflow-y-auto lg:px-5"
              >
                {reviewPanel?.(context)}
              </div>
            </aside>
          ) : reference ? (
            // Режим чтения (в работе коллега): решать нечего, но эталон
            // по-прежнему нужен — сверять можно и глазами.
            <aside
              data-testid="review-reference-column"
              className="shrink-0 border-t border-graphite-200 bg-white p-4 lg:w-[380px] lg:overflow-y-auto lg:border-l lg:border-t-0"
            >
              {reference}
            </aside>
          ) : null}
        </div>

        {showReviewPanel && reviewBar && (
          <div
            data-testid="review-bar"
            className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-graphite-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_rgba(31,85,224,0.06)] lg:static lg:px-7 lg:shadow-none"
          >
            {reviewBar(context)}
          </div>
        )}
      </div>
    )
  }

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
      {filesStrip}

      {/* Решение слева, работа справа: сравнивать удобнее, когда оба на
          экране, а не в двух вкладках. На узком экране панель уезжает наверх —
          «сначала решение, потом фото» сохраняется и там.

          §210. С третьей колонкой ниже 1024 блоков становится три, и в один
          экран они не влезают — там вся полоса прокручивается целиком, сверху
          вниз: решение, работа, таблица. Без третьей колонки (ученик,
          «Пометки учителя») раскладка остаётся ровно прежней — прокрутки у
          полосы нет, и у ученика ничего не едет. */}
      <div
        ref={splitRef}
        data-testid="attempt-split-row"
        className={cn(
          'flex min-h-0 flex-1 flex-col lg:flex-row',
          showReviewPanel && 'overflow-y-auto lg:overflow-hidden',
        )}
      >
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
        <div
          data-testid="attempt-work-column"
          className={cn(
            'min-h-0 overflow-auto p-3 sm:p-4 [@media(min-width:700px)_and_(max-height:600px)]:p-0',
            // §210. Ниже 1024 с тремя блоками работе нужна СВОЯ высота: иначе
            // она либо съест таблицу, либо схлопнется под неё. 70vh — экран
            // минус шапка, примерно столько же, сколько было до третьей
            // колонки. С 1024 колонка снова делит ширину, а не высоту.
            showReviewPanel
              ? 'h-[70vh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink'
              : 'flex-1',
          )}
        >
        {workContent}
        </div>

        {/*
          §210. Вторая граница — между работой и таблицей проверки. Устроена
          так же, как первая (§208): Pointer Events на мышь и палец, стрелки с
          клавиатуры, с 1024 и выше. Разница одна: доля считается от ПРАВОГО
          края, поэтому «стрелка вправо» делает таблицу уже — ручка едет туда,
          куда показывает стрелка.
        */}
        {showReviewPanel && (
          <div
            data-testid="review-split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ширина колонки проверки"
            aria-valuemin={Math.round(MIN_TABLE_FRACTION * 100)}
            aria-valuemax={Math.round(MAX_TABLE_FRACTION * 100)}
            aria-valuenow={Math.round(tableFraction * 100)}
            tabIndex={0}
            onPointerDown={e => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
              setTableDragging(true)
            }}
            onPointerMove={e => { if (tableDragging) moveTableSplit(e.clientX) }}
            onPointerUp={() => {
              if (!tableDragging) return
              setTableDragging(false)
              writeTableFraction(tableFraction)
            }}
            onPointerCancel={() => setTableDragging(false)}
            onKeyDown={e => {
              const step = e.key === 'ArrowLeft' ? 0.02 : e.key === 'ArrowRight' ? -0.02 : 0
              if (!step) return
              e.preventDefault()
              stepTableSplit(step)
            }}
            className={cn(
              'hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-slate-200 transition-colors lg:block',
              'hover:bg-primary-300 focus-visible:bg-primary-400 focus-visible:outline-none',
              tableDragging && 'bg-primary-400',
            )}
          />
        )}

        {/*
          Третья колонка: таблица проверки и форма вердикта. Свой свиток —
          в этом и был смысл переезда: раньше колесо в таблице уводило работу,
          потому что таблица лежала в одном свитке со страницами.
        */}
        {showReviewPanel && (
          <aside
            data-testid="review-side-column"
            style={{ ['--review-side-w' as string]: tableFractionToPercent(tableFraction) }}
            className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-slate-200 bg-slate-100 lg:h-full lg:w-[var(--review-side-w,37%)] lg:border-l lg:border-t-0"
          >
            {/*
              §211. Прокручивается вся колонка целиком, а не только таблица
              внутри неё: форма вердикта вернулась в поток и стоит за
              таблицей, а не прижата к низу (§210 делал наоборот).
            */}
            <div
              data-testid="review-side-scroll-area"
              className="flex min-h-0 flex-col p-3 sm:p-4 lg:flex-1 lg:overflow-y-auto"
            >
              {reviewPanel?.({ publishAnnotations })}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
