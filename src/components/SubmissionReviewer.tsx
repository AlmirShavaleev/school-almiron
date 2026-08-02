import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Save, Trash2, ZoomIn, ZoomOut, FileText, MessageSquare, AlertCircle } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { extractStoragePath, getSignedFileUrl, type PrivateBucket } from '@/lib/storage'
import { HANDLE_CURSOR, moveRect, rectsEqual, resizeRect, type ResizeHandle } from '@/lib/annotationGeometry'
import { cn } from '@/utils/cn'
import { toast } from '@/store/toastStore'
import type { MutableRefObject, ReactNode } from 'react'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type Category = 'comment' | 'calc' | 'logic' | 'format' | 'praise'
type Point = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }
type Region = { id: string; type: 'region'; rect: Rect; category: Category; text: string }
type Draft = { filePath: string; page: number; globalPage: number; fileIndex: number; rect: Rect; category: Category; text: string }
type LegacyMark =
  | { id: string; type: 'stroke'; points: Point[]; color: string; width: number }
  | { id: string; type: 'highlight'; points: Point[]; color: string; width: number }
  | { id: string; type: 'stamp'; value: '✓' | '✕'; x: number; y: number; color: string; size: number }
  | { id: string; type: 'text'; text: string; x: number; y: number; color: string; size: number }
type Mark = Region | LegacyMark
type PageData = { version: 2; objects: Mark[] }
type Row = { page: number; file_path: string; data: unknown; status: 'draft' | 'published'; author_id?: string | null }
type RegionItem = Region & { filePath: string; page: number; globalPage: number; fileIndex: number; fileLabel: string; surfaceKey: string }
type PageMetrics = { width: number; height: number; ratio: number }
type DragState = { surfaceKey: string; rect: Rect } | null
/** Правка существующей рамки: перенос целиком или растягивание за одну ручку. */
type RegionEdit = {
  id: string
  surfaceKey: string
  filePath: string
  page: number
  mode: 'move' | 'resize'
  handle: ResizeHandle | null
  startPoint: Point
  startRect: Rect
}
/** Что показываем поверх сохранённой рамки, пока её тянут. */
type EditPreview = { id: string; surfaceKey: string; rect: Rect } | null
type SourceFile = { filePath: string; url: string; ext: string; kind: 'pdf' | 'image' }
type DocumentSurface = {
  surfaceKey: string
  filePath: string
  fileIndex: number
  fileLabel: string
  kind: 'pdf' | 'image'
  page: number
  globalPage: number
  url: string
  metrics?: PageMetrics
}
type FooterRenderContext = {
  publishing: boolean
  published: boolean
  triggerPublish: (targetStatus?: 'checked' | 'revision') => void
}
type FooterContent = ReactNode | ((context: FooterRenderContext) => ReactNode)

/**
 * Цель аннотаций. Ровно одна из двух — тем же правилом, что CHECK
 * annotation_sets_one_target_chk в базе, только проверяется на этапе
 * компиляции (`?: never` не даст передать обе):
 *  - submissionId — старый контур (homework_submissions, бакет 'homeworks');
 *  - attemptId    — новый контур (topic_homework_attempts,
 *                   бакет 'topic-homework-attempts').
 */
type AnnotationTarget =
  | { submissionId: string; attemptId?: never }
  | { attemptId: string; submissionId?: never }

interface BaseProps {
  /** Бакет, в котором лежат файлы работы. По умолчанию — старый контур. */
  bucket?: PrivateBucket
  filePath: string
  filePaths?: string[]
  readOnly?: boolean
  annotationVisibility?: 'all' | 'published'
  className?: string
  fitWidth?: boolean
  footer?: FooterContent
  footerPublishLabel?: string
  /**
   * Подпись кнопки публикации в тулбаре. По умолчанию «Опубликовать проверку»
   * (старый контур, где публикация рамок и есть публикация проверки). Там, где
   * вердикт ставится отдельной формой, подпись должна честно говорить, что
   * кнопка публикует только пометки.
   */
  publishButtonLabel?: string
  /**
   * Спрятать кнопку публикации в тулбаре. Нужно там, где решение принимается
   * внешней формой вердикта: две зелёные кнопки рядом («Опубликовать» в тулбаре
   * и «Принять/Вернуть» в футере) читались как одно и то же действие —
   * владелец решил, что публикация сама отправила работу на доработку.
   * Пометки в этом режиме публикуются вместе с вердиктом, через publishRef.
   */
  hideToolbarPublish?: boolean
  header?: ReactNode
  onPublish?: (targetStatus?: 'checked' | 'revision') => Promise<boolean | void>
  onPublishComplete?: (success: boolean) => void
  /**
   * Императивный доступ к публикации рамок (draft → published).
   * Нужен там, где кнопку рисует не футер аннотатора, а внешняя форма
   * вердикта: она сначала публикует пометки, потом ставит оценку — чтобы
   * ученик не получил вердикт без пометок, на которые тот ссылается.
   */
  publishRef?: MutableRefObject<((targetStatus?: 'checked' | 'revision') => Promise<boolean>) | null>
  /**
   * Императивный перенос готовых рамок в разбор — им пользуется панель
   * черновика ИИ. Возвращает, сколько рамок реально легло на страницы.
   */
  importRegionsRef?: MutableRefObject<((regions: ImportedRegion[]) => Promise<number>) | null>
}

/** Рамка, приходящая извне (черновик ИИ), до превращения в обычную пометку. */
export interface ImportedRegion {
  filePath: string
  page: number
  rect: { x: number; y: number; w: number; h: number }
  category: Category
  text: string
}

type Props = BaseProps & AnnotationTarget

const MIN_REGION_SIZE = 0.015
/**
 * Размер ручки — доля ШИРИНЫ страницы. По высоте домножаем на соотношение
 * сторон: viewBox 0 0 1 1 с preserveAspectRatio="none" растягивает оси
 * по-разному, и одинаковые числа дали бы вытянутые прямоугольники вместо
 * квадратиков.
 */
const HANDLE_UNIT = 0.013
/** Шаг стрелок на клавиатуре — «чуть-чуть», примерно 2-3 пикселя на листе A4. */
const NUDGE_STEP = 0.003
const EMPTY: PageData = { version: 2, objects: [] }
const CATEGORIES: Record<Category, { label: string; short: string; color: string; bg: string; ring: string; phrases: string[] }> = {
  comment: { label: 'Комментарий', short: 'K', color: '#2563eb', bg: 'bg-blue-50', ring: 'ring-blue-500/35', phrases: [] },
  calc: { label: 'Вычислительная ошибка', short: 'В', color: '#dc2626', bg: 'bg-red-50', ring: 'ring-red-500/35', phrases: ['Ошибка в вычислениях', 'Проверь знаки', 'Арифметическая ошибка'] },
  logic: { label: 'Логическая ошибка', short: 'Л', color: '#7c3aed', bg: 'bg-violet-50', ring: 'ring-violet-500/35', phrases: ['Неверный ход решения', 'Пропущен шаг', 'Не следует из предыдущего'] },
  format: { label: 'Оформление', short: 'О', color: '#ea580c', bg: 'bg-orange-50', ring: 'ring-orange-500/35', phrases: ['Запиши полное решение', 'Нет единиц измерения', 'Неаккуратно'] },
  praise: { label: 'Отлично', short: '✓', color: '#16a34a', bg: 'bg-emerald-50', ring: 'ring-emerald-500/35', phrases: ['Отлично!', 'Верное решение', 'Молодец'] },
}

const id = () => crypto.randomUUID()
const isRegion = (mark: Mark): mark is Region => mark.type === 'region'
const inflightPageSaves = new Map<string, Promise<boolean>>()
const pageKey = (filePath: string, page: number) => `${filePath}::${page}`
const parsePageKey = (key: string) => {
  const [filePath, page] = key.split('::')
  return { filePath, page: Number(page) }
}
const cleanData = (data: unknown): PageData => {
  const value = data as { objects?: unknown[] } | null
  return { version: 2, objects: Array.isArray(value?.objects) ? value.objects as Mark[] : [] }
}
const normalizeRect = (start: Point, end: Point): Rect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  w: Math.abs(end.x - start.x),
  h: Math.abs(end.y - start.y),
})
const pageWithVersion = (objects: Mark[]): PageData => ({ version: 2, objects })
const isPermissionError = (error: unknown) => {
  const candidate = error as { code?: string; status?: number; message?: string; details?: string; hint?: string } | null
  const text = `${candidate?.message || ''} ${candidate?.details || ''} ${candidate?.hint || ''}`.toLowerCase()
  return candidate?.status === 403
    || candidate?.code === '42501'
    || text.includes('row-level security')
    || text.includes('permission denied')
    || text.includes('insufficient_privilege')
}
const getSaveErrorMessage = (error: unknown) => (
  isPermissionError(error)
    ? 'Нет прав на сохранение проверки'
    : 'Не удалось сохранить проверку. Проверьте соединение и попробуйте ещё раз'
)

function SaveStatePill({ saving, saveState }: { saving: boolean; saveState: 'idle' | 'saved' | 'error' }) {
  if (saving) return (
    <div data-testid="review-save-state" className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
      <Loader2 size={12} className="animate-spin" />
      <span>Сохраняю</span>
    </div>
  )
  if (saveState === 'saved') return (
    <div data-testid="review-save-state" className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      <Save size={12} />
      <span>Сохранено</span>
    </div>
  )
  if (saveState === 'error') return (
    <div data-testid="review-save-state" className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
      <AlertCircle size={12} />
      <span>Ошибка сохранения</span>
    </div>
  )
  return null
}

export function SubmissionReviewer({
  submissionId,
  attemptId,
  bucket = 'homeworks',
  filePath,
  filePaths,
  readOnly = false,
  annotationVisibility,
  className,
  fitWidth = true,
  footer,
  footerPublishLabel,
  publishButtonLabel = 'Опубликовать проверку',
  hideToolbarPublish = false,
  header,
  onPublish,
  onPublishComplete,
  publishRef,
  importRegionsRef,
}: Props) {
  // Одна цель на весь компонент: колонка + значение. attemptId приоритетнее —
  // если по недосмотру передали оба, пишем в новый контур, а не молча в старый
  // (CHECK в базе всё равно не даст записать сразу оба).
  const myProfileId = useAuthStore(s => s.profile?.id)
  const targetColumn = attemptId ? 'attempt_id' : 'submission_id'
  const targetId = attemptId ?? submissionId
  const normalizedPaths = useMemo(() => {
    const raw = filePaths?.length ? filePaths : [filePath]
    return raw.map(path => extractStoragePath(path, bucket) ?? path)
  }, [bucket, filePath, filePaths])
  const effectiveAnnotationVisibility = annotationVisibility ?? (readOnly ? 'published' : 'all')
  const persistenceKey = useMemo(
    () => `${targetColumn}:${targetId}:${normalizedPaths.join('|')}`,
    [normalizedPaths, targetColumn, targetId],
  )
  const frameRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragStartRef = useRef<{ surfaceKey: string; filePath: string; fileIndex: number; page: number; globalPage: number; point: Point } | null>(null)
  const editRef = useRef<RegionEdit | null>(null)
  /**
   * Правка стрелками применяется к состоянию сразу, а в базу уходит на отпускании
   * клавиши: автоповтор даёт до полусотни нажатий, и писать страницу целиком на
   * каждое — лишний трафик. Ждём не таймер, а конец жеста, поэтому «нажал и ушёл»
   * ничего не теряет: флаш стоит и на смене выделения, и на размонтировании, а
   * публикация всё равно пересохраняет страницы из состояния.
   */
  const pendingNudgeRef = useRef<{ filePath: string; page: number; data: PageData } | null>(null)

  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageCount, setPageCount] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [frameWidth, setFrameWidth] = useState(0)
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({})
  const [pageMetrics, setPageMetrics] = useState<Record<string, PageMetrics>>({})
  const [pages, setPages] = useState<Record<string, PageData>>({})
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Подсветка (activeId) живёт на наведении, выделение (selectedId) — на клике.
  // Разные вещи: ручки правки не должны появляться под курсором сами собой, а
  // стрелки на клавиатуре обязаны двигать ровно ту рамку, которую выбрали.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState>(null)
  const [editPreview, setEditPreview] = useState<EditPreview>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [visiblePages, setVisiblePages] = useState<Set<string>>(new Set())
  const [hasOtherAuthor, setHasOtherAuthor] = useState(false)

  const pdfRefs = useRef<Record<string, pdfjs.PDFDocumentProxy | null>>({})
  const visibilityRef = useRef<Record<string, number>>({})

  const surfaces = useMemo(() => {
    let globalPage = 1
    return sourceFiles.flatMap((source, fileIndex) => {
      if (source.kind === 'image') {
        const surfaceKey = `${fileIndex + 1}:1`
        const surface: DocumentSurface = {
          surfaceKey,
          filePath: source.filePath,
          fileIndex,
          fileLabel: `файл ${fileIndex + 1}`,
          kind: 'image',
          page: 1,
          globalPage,
          url: source.url,
          metrics: pageMetrics[pageKey(source.filePath, 1)],
        }
        globalPage += 1
        return [surface]
      }

      const doc = pdfRefs.current[source.filePath]
      const docPages = doc?.numPages ?? 0
      return Array.from({ length: docPages }, (_value, index) => {
        const page = index + 1
        const surfaceKey = `${fileIndex + 1}:${page}`
        const surface: DocumentSurface = {
          surfaceKey,
          filePath: source.filePath,
          fileIndex,
          fileLabel: `файл ${fileIndex + 1}`,
          kind: 'pdf',
          page,
          globalPage,
          url: source.url,
          metrics: pageMetrics[pageKey(source.filePath, page)],
        }
        globalPage += 1
        return surface
      })
    })
  }, [pageMetrics, sourceFiles])

  const surfaceByKey = useMemo(() => Object.fromEntries(surfaces.map(surface => [surface.surfaceKey, surface])), [surfaces])

  const regions = useMemo(() => surfaces
    .flatMap(surface => (pages[pageKey(surface.filePath, surface.page)] ?? EMPTY).objects
      .filter(isRegion)
      .map(region => ({ ...region, filePath: surface.filePath, page: surface.page, globalPage: surface.globalPage, fileIndex: surface.fileIndex, fileLabel: surface.fileLabel, surfaceKey: surface.surfaceKey })))
    .sort((a, b) => a.globalPage - b.globalPage), [pages, surfaces])

  useEffect(() => {
    if (!surfaces.length) return
    setPageCount(surfaces.length)
    setVisiblePages(new Set(surfaces.slice(0, 2).map(surface => surface.surfaceKey)))
    setCurrentPage(1)
  }, [surfaces])

  const getUrls = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await Promise.all(normalizedPaths.map(async path => {
        const url = await getSignedFileUrl(bucket, path)
        if (!url) throw new Error('Файл не найден')
        const ext = path.split('?')[0].split('.').pop()?.toLowerCase() || ''
        if (ext === 'pdf') return { filePath: path, url, ext, kind: 'pdf' as const }
        // webp/heic ученик тоже может прислать (в инпуте accept="image/*"),
        // браузер их рисует — значит рамки по ним ставить можно.
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'].includes(ext)) {
          return { filePath: path, url, ext, kind: 'image' as const }
        }
        throw new Error('Предпросмотр доступен только для PDF и картинок.')
      }))
      setSourceFiles(next)
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось открыть файл')
      setLoading(false)
    }
  }, [bucket, normalizedPaths])

  useEffect(() => { void getUrls() }, [getUrls])

  useEffect(() => {
    let active = true
    ;(async () => {
      const pending = inflightPageSaves.get(persistenceKey)
      if (pending) {
        try {
          await pending
        } catch {
          // savePage already reports persistence failures
        }
      }
      if (!active) return

      const query = (supabase as any).from('annotation_sets').select('page,data,status,file_path,author_id')
        .eq(targetColumn, targetId)
      if (normalizedPaths.length === 1) query.eq('file_path', normalizedPaths[0])
      else query.in('file_path', normalizedPaths)
      if (effectiveAnnotationVisibility === 'published') query.eq('status', 'published')
      const { data } = await query as { data: Row[] | null }
      if (!active) return
      const next: Record<string, PageData> = {}
      for (const row of data ?? []) next[pageKey(row.file_path || normalizedPaths[0], row.page)] = cleanData(row.data)
      setPages(next)
      setPublished((data ?? []).some(row => row.status === 'published'))
      // Работу мог уже смотреть другой сотрудник курса: очередь у персонала
      // общая, и никакого «занято» в ней нет. Отмечаем это явно — иначе второй
      // проверяющий не поймёт, чьи рамки видит, и рискует переписать чужую
      // работу своим сохранением (страница пишется целиком).
      setHasOtherAuthor(
        (data ?? []).some(row => row.author_id && row.author_id !== myProfileId),
      )
    })()
    return () => { active = false }
  }, [effectiveAnnotationVisibility, myProfileId, normalizedPaths, persistenceKey, targetColumn, targetId])

  useEffect(() => {
    if (!sourceFiles.length) return
    let active = true
    const tasks = sourceFiles
      .filter(source => source.kind === 'pdf')
      .map(source => ({ source, task: pdfjs.getDocument({ url: source.url }) }))

    Promise.all(tasks.map(async ({ source, task }) => {
      const doc = await task.promise
      pdfRefs.current[source.filePath] = doc
      const metricsEntries = await Promise.all(
        Array.from({ length: doc.numPages }, async (_value, index) => {
          const pageNumber = index + 1
          const pdfPage = await doc.getPage(pageNumber)
          const viewport = pdfPage.getViewport({ scale: 1 })
          return [pageKey(source.filePath, pageNumber), { width: viewport.width, height: viewport.height, ratio: viewport.width / viewport.height }] as const
        }),
      )
      return { filePath: source.filePath, doc, metricsEntries }
    })).then(results => {
      if (!active) return
      const nextMetrics: Record<string, PageMetrics> = {}
      for (const source of sourceFiles) {
        if (source.kind === 'image') {
          nextMetrics[pageKey(source.filePath, 1)] = { width: 1000, height: 1414, ratio: imageRatios[source.filePath] || 1 / 1.414 }
          continue
        }
        const result = results.find(item => item.filePath === source.filePath)
        Object.assign(nextMetrics, Object.fromEntries(result?.metricsEntries || []))
      }
      setPageMetrics(prev => ({ ...prev, ...nextMetrics }))
      setLoading(false)
    }).catch((e: any) => {
      if (!active) return
      // Отдельно про воркер pdf.js: если браузер не смог его подгрузить
      // (в проде так падало из-за Content-Type у .mjs), сообщение вида
      // «Setting up fake worker failed» ничего не говорит преподавателю.
      // Показываем понятный текст — а ссылка «открыть файл» рядом даёт
      // возможность посмотреть работу, пока движок разметки недоступен.
      const raw = String(e?.message ?? '')
      setError(
        /fake worker|dynamically imported module|worker/i.test(raw)
          ? 'Не удалось загрузить движок просмотра PDF. Откройте файл отдельно — ссылка выше.'
          : raw || 'Не удалось открыть файл',
      )
      setLoading(false)
    })
    return () => {
      active = false
      for (const { task } of tasks) void task.destroy()
      pdfRefs.current = {}
    }
  }, [imageRatios, sourceFiles])

  useEffect(() => {
    if (!fitWidth || !frameRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      const width = rect ? Math.round(rect.width) : 0
      setFrameWidth(prev => (prev === width ? prev : width))
    })
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [fitWidth])

  useEffect(() => {
    if (!surfaces.length || !frameRef.current || typeof IntersectionObserver === 'undefined') return
    const root = frameRef.current
    const observer = new IntersectionObserver(entries => {
      const ratios = { ...visibilityRef.current }
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.surfaceKey
        if (!key) continue
        ratios[key] = entry.intersectionRatio
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setVisiblePages(prev => {
            const next = new Set(prev)
            const index = surfaces.findIndex(surface => surface.surfaceKey === key)
            for (const nearby of [index - 1, index, index + 1]) {
              if (nearby >= 0 && nearby < surfaces.length) next.add(surfaces[nearby].surfaceKey)
            }
            return next
          })
        }
      }
      visibilityRef.current = ratios
      const best = Object.entries(ratios)
        .map(([key, ratio]) => ({ key, ratio }))
        .filter(item => item.ratio > 0)
        .sort((a, b) => b.ratio - a.ratio || a.key.localeCompare(b.key))[0]
      if (best) setCurrentPage(surfaceByKey[best.key]?.globalPage ?? 1)
    }, { root, threshold: [0, 0.2, 0.5, 0.8, 1] })

    for (const surface of surfaces) {
      const node = pageRefs.current[surface.surfaceKey]
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [surfaces, surfaceByKey])

  // Every mutation (saveDraft, deleteRegion) is an explicit user action and
  // persists immediately through this — no debounce, no "dirty" queue.
  // There used to be one: edits were batched and flushed 2s after the last
  // change, which meant an explicit "Сохранить" click could still be
  // sitting unsent when the teacher navigated away right after. Debouncing
  // makes sense for high-frequency background sync, not for the one moment
  // the user directly told us to save.
  const savePage = useCallback(async (filePath: string, number: number, data: PageData) => {
    if (readOnly) return true
    const previous = inflightPageSaves.get(persistenceKey)
    const persist = (async () => {
      if (previous) {
        try {
          await previous
        } catch {
          // let the newer explicit save still run
        }
      }
      setSaving(true)
      setSaveState('idle')
      const { error: saveError } = await (supabase as any).from('annotation_sets').upsert({
        [targetColumn]: targetId,
        file_path: filePath,
        page: number,
        data: { ...data, version: 2 },
        status: 'draft',
      }, { onConflict: `${targetColumn},file_path,page` })
      setSaving(false)
      setSaveState(saveError ? 'error' : 'saved')
      if (saveError) {
        console.error('Не удалось сохранить аннотации', saveError)
        toast.error(getSaveErrorMessage(saveError))
        return false
      }
      setPublished(false)
      return true
    })()
    inflightPageSaves.set(persistenceKey, persist)
    try {
      return await persist
    } finally {
      if (inflightPageSaves.get(persistenceKey) === persist) {
        inflightPageSaves.delete(persistenceKey)
      }
    }
  }, [persistenceKey, readOnly, targetColumn, targetId])

  const pointOn = (element: SVGGraphicsElement, event: { clientX: number; clientY: number }): Point => {
    const bounds = element.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  /** Рамка под курсором в текущем жесте — с учётом режима (перенос/растягивание). */
  const editedRect = (edit: RegionEdit, point: Point): Rect => {
    const dx = point.x - edit.startPoint.x
    const dy = point.y - edit.startPoint.y
    return edit.mode === 'move' || !edit.handle
      ? moveRect(edit.startRect, dx, dy)
      : resizeRect(edit.startRect, edit.handle, dx, dy, MIN_REGION_SIZE)
  }

  /**
   * Начало правки готовой рамки. Событие приходит с самой рамки или с ручки,
   * поэтому: захватываем указатель на этом элементе (движение продолжит
   * приходить, даже если курсор ушёл со страницы) и глушим всплытие — иначе
   * тот же pointerdown начал бы рисовать поверх новую рамку.
   */
  function beginRegionEdit(
    surface: DocumentSurface,
    region: Region,
    mode: 'move' | 'resize',
    handle: ResizeHandle | null,
    event: React.PointerEvent<SVGElement>,
  ) {
    if (readOnly || draft) return
    event.stopPropagation()
    const target = event.currentTarget as SVGGraphicsElement
    target.setPointerCapture(event.pointerId)
    const svg = target.ownerSVGElement ?? target
    editRef.current = {
      id: region.id,
      surfaceKey: surface.surfaceKey,
      filePath: surface.filePath,
      page: surface.page,
      mode,
      handle,
      startPoint: pointOn(svg, event),
      startRect: region.rect,
    }
    void flushNudge()
    setActiveId(region.id)
    setSelectedId(region.id)
    setCurrentPage(surface.globalPage)
    setEditPreview({ id: region.id, surfaceKey: surface.surfaceKey, rect: region.rect })
  }

  /** Новая геометрия рамки: сразу в состояние, следом — в базу. */
  async function commitRegionRect(filePath: string, page: number, regionId: string, rect: Rect) {
    const key = pageKey(filePath, page)
    const pageData = pages[key] ?? EMPTY
    const nextData = pageWithVersion(pageData.objects.map(mark => (
      mark.id === regionId && isRegion(mark) ? { ...mark, rect } : mark
    )))
    // Оптимистично: иначе рамка на время запроса прыгала бы обратно на старое
    // место. При отказе возвращаем прежнюю страницу — savePage уже показал тост.
    setPages(value => ({ ...value, [key]: nextData }))
    const ok = await savePage(filePath, page, nextData)
    if (!ok) setPages(value => ({ ...value, [key]: pageData }))
  }

  async function flushNudge() {
    const pending = pendingNudgeRef.current
    if (!pending) return
    pendingNudgeRef.current = null
    await savePageRef.current(pending.filePath, pending.page, pending.data)
  }

  function pointerDown(surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) {
    if (readOnly || draft) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointOn(event.currentTarget, event)
    // Клик по пустому месту снимает выделение: стрелки после этого не должны
    // двигать рамку, о которой преподаватель уже забыл.
    setSelectedId(null)
    void flushNudge()
    dragStartRef.current = { surfaceKey: surface.surfaceKey, filePath: surface.filePath, fileIndex: surface.fileIndex, page: surface.page, globalPage: surface.globalPage, point }
    setDragState({ surfaceKey: surface.surfaceKey, rect: { x: point.x, y: point.y, w: 0, h: 0 } })
  }

  function pointerMove(surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) {
    if (readOnly) return
    const edit = editRef.current
    if (edit) {
      if (edit.surfaceKey !== surface.surfaceKey) return
      setEditPreview({ id: edit.id, surfaceKey: edit.surfaceKey, rect: editedRect(edit, pointOn(event.currentTarget, event)) })
      return
    }
    if (!dragStartRef.current || dragStartRef.current.surfaceKey !== surface.surfaceKey) return
    const start = dragStartRef.current.point
    setDragState({ surfaceKey: surface.surfaceKey, rect: normalizeRect(start, pointOn(event.currentTarget, event)) })
  }

  function pointerUp(surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) {
    if (readOnly) return
    const edit = editRef.current
    if (edit) {
      if (edit.surfaceKey !== surface.surfaceKey) return
      editRef.current = null
      setEditPreview(null)
      const nextRect = editedRect(edit, pointOn(event.currentTarget, event))
      // Просто клик по рамке (выделить) — не правка, писать нечего.
      if (rectsEqual(nextRect, edit.startRect)) return
      void commitRegionRect(edit.filePath, edit.page, edit.id, nextRect)
      return
    }
    if (!dragStartRef.current || dragStartRef.current.surfaceKey !== surface.surfaceKey) return
    const nextRect = normalizeRect(dragStartRef.current.point, pointOn(event.currentTarget, event))
    dragStartRef.current = null
    setDragState(null)
    if (nextRect.w < MIN_REGION_SIZE || nextRect.h < MIN_REGION_SIZE) return
    setCurrentPage(surface.globalPage)
    setDraft({ filePath: surface.filePath, page: surface.page, globalPage: surface.globalPage, fileIndex: surface.fileIndex, rect: nextRect, category: 'comment', text: '' })
  }

  // Explicit user actions (Сохранить / delete) persist immediately, awaited
  // — never queued behind the 2s debounce. The debounce exists to coalesce
  // rapid-fire edits into fewer writes; it was never meant to be the ONLY
  // path for something the user just told us, in words, to save right now.
  // Waiting on a timer for an explicit "Сохранить" click left a window
  // where a fast "Сохранить → Назад" lost the comment outright (the
  // in-flight fetch itself isn't cancelled by an SPA route change, so this
  // closes the window almost entirely — see commit message for the residual).
  async function saveDraft() {
    if (!draft) return
    const text = draft.text.trim()
    if (!text && draft.category !== 'praise') return
    const region: Region = { id: id(), type: 'region', rect: draft.rect, category: draft.category, text }
    const key = pageKey(draft.filePath, draft.page)
    const pageData = pages[key] ?? EMPTY
    const nextData = pageWithVersion([...pageData.objects, region])
    const ok = await savePage(draft.filePath, draft.page, nextData)
    if (!ok) return
    setPages(value => ({ ...value, [key]: nextData }))
    setActiveId(region.id)
    setDraft(null)
  }

  async function deleteRegion(item: RegionItem) {
    const key = pageKey(item.filePath, item.page)
    const pageData = pages[key] ?? EMPTY
    const nextData = pageWithVersion(pageData.objects.filter(mark => mark.id !== item.id))
    const ok = await savePage(item.filePath, item.page, nextData)
    if (!ok) return
    setPages(value => ({ ...value, [key]: nextData }))
    if (activeId === item.id) setActiveId(null)
    if (selectedId === item.id) setSelectedId(null)
  }

  function activateRegion(item: RegionItem) {
    setCurrentPage(item.globalPage)
    setActiveId(item.id)
    // Клик по комментарию выделяет рамку: дальше её можно подвинуть стрелками,
    // не выцеливая мышью маленький прямоугольник на странице.
    if (!readOnly) setSelectedId(item.id)
    pageRefs.current[item.surfaceKey]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // Свежие значения для оконных слушателей: подписка не должна пересоздаваться
  // на каждый рендер, а замыкание с первого рендера устарело бы. Пишем в
  // эффекте, а не в теле — во время рендера ref трогать нельзя.
  const savePageRef = useRef(savePage)
  const keyboardRef = useRef({ selectedId, regions })
  useEffect(() => {
    savePageRef.current = savePage
    keyboardRef.current = { selectedId, regions }
  })

  /**
   * Стрелки двигают выделенную рамку, Shift+стрелки меняют её размер. Мышью
   * попасть «на пару пикселей левее» тяжело, а ИИ промахивается ровно на столько.
   */
  useEffect(() => {
    if (readOnly) return
    const ARROWS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    function onKeyDown(event: KeyboardEvent) {
      const delta = ARROWS[event.key]
      if (!delta || event.metaKey || event.ctrlKey || event.altKey) return
      const { selectedId: id, regions: items } = keyboardRef.current
      if (!id) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const item = items.find(region => region.id === id)
      if (!item) return
      event.preventDefault()
      const [dx, dy] = delta
      const key = pageKey(item.filePath, item.page)
      // Функциональное обновление, а не чтение из замыкания: автоповтор шлёт
      // события чаще, чем React успевает перерисовать, и шаги должны
      // складываться, а не перезаписывать друг друга одним и тем же сдвигом.
      setPages(value => {
        const pageData = value[key] ?? EMPTY
        const current = pageData.objects.find(mark => mark.id === id)
        if (!current || !isRegion(current)) return value
        const nextRect = event.shiftKey
          ? resizeRect(current.rect, dx !== 0 ? 'e' : 's', dx * NUDGE_STEP, dy * NUDGE_STEP, MIN_REGION_SIZE)
          : moveRect(current.rect, dx * NUDGE_STEP, dy * NUDGE_STEP)
        if (rectsEqual(nextRect, current.rect)) return value
        const nextData = pageWithVersion(pageData.objects.map(mark => (
          mark.id === id && isRegion(mark) ? { ...mark, rect: nextRect } : mark
        )))
        pendingNudgeRef.current = { filePath: item.filePath, page: item.page, data: nextData }
        return { ...value, [key]: nextData }
      })
    }
    function onKeyUp(event: KeyboardEvent) {
      if (ARROWS[event.key]) void flushNudge()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      void flushNudge()
    }
  }, [readOnly])

  // Смена выделения дописывает предыдущую рамку: уйти со страницы, не сохранив
  // сдвиг стрелками, нельзя.
  useEffect(() => () => { void flushNudge() }, [selectedId])

  async function publish(targetStatus: 'checked' | 'revision' = 'checked'): Promise<boolean> {
    setPublishing(true)
    if (onPublish && await onPublish(targetStatus) === false) {
      setPublishing(false)
      onPublishComplete?.(false)
      return false
    }
    // Every edit is already persisted by the time it's made (saveDraft/
    // deleteRegion await savePage immediately) — this re-save is just a
    // belt-and-suspenders confirmation pass, not catching up on a backlog.
    const ok = await Promise.all(Object.entries(pages).map(([key, data]) => {
      const parsed = parsePageKey(key)
      return savePage(parsed.filePath, parsed.page, data ?? EMPTY)
    }))
    if (!ok.every(Boolean)) {
      setPublishing(false)
      onPublishComplete?.(false)
      return false
    }
    const publishQuery = (supabase as any).from('annotation_sets').update({ status: 'published' })
      .eq(targetColumn, targetId)
    const publishResult = normalizedPaths.length === 1
      ? await publishQuery.eq('file_path', normalizedPaths[0])
      : await publishQuery.in('file_path', normalizedPaths)
    const publishError = publishResult?.error ?? null
    setSaveState(publishError ? 'error' : 'saved')
    setPublishing(false)
    if (publishError) {
      onPublishComplete?.(false)
      return false
    }
    setPublished(true)
    onPublishComplete?.(true)
    return true
  }

  // Без массива зависимостей: publish пересоздаётся каждый рендер и замыкает
  // текущие pages — ref должен указывать на свежую версию, иначе внешняя форма
  // вердикта опубликует устаревший набор страниц.
  useEffect(() => {
    if (!publishRef) return
    publishRef.current = publish
    return () => { publishRef.current = null }
  })

  /**
   * Перенести чужие рамки в разбор (сейчас — черновик ИИ).
   *
   * Ключевое здесь: рамки становятся ОБЫЧНЫМИ рамками преподавателя. Тот же
   * тип, тот же author_id, та же дальнейшая судьба — их можно двигать,
   * править и удалять. Никакого отдельного «режима ИИ» в разборе нет и не
   * должно быть: преподаватель принял предложение, дальше это его пометки.
   *
   * Страницы сохраняются по одной и последовательно: savePage перезаписывает
   * страницу целиком, и параллельные вызовы затёрли бы друг друга.
   */
  async function importRegions(items: ImportedRegion[]): Promise<number> {
    if (readOnly || items.length === 0) return 0

    const byPage = new Map<string, { filePath: string; page: number; regions: Region[] }>()
    for (const item of items) {
      const text = item.text.trim()
      if (!text) continue
      if (item.rect.w < MIN_REGION_SIZE || item.rect.h < MIN_REGION_SIZE) continue
      const key = pageKey(item.filePath, item.page)
      const bucket = byPage.get(key) ?? { filePath: item.filePath, page: item.page, regions: [] }
      bucket.regions.push({ id: id(), type: 'region', rect: item.rect, category: item.category, text })
      byPage.set(key, bucket)
    }

    let imported = 0
    const nextPages: Record<string, PageData> = {}
    for (const [key, bucket] of byPage) {
      const base = nextPages[key] ?? pages[key] ?? EMPTY
      const nextData = pageWithVersion([...base.objects, ...bucket.regions])
      const ok = await savePage(bucket.filePath, bucket.page, nextData)
      // Сбой на одной странице не должен отменять уже перенесённые: они уже
      // в базе, и «откатить» их значило бы стереть заодно ручные пометки.
      if (!ok) continue
      nextPages[key] = nextData
      imported += bucket.regions.length
    }

    if (imported > 0) setPages(value => ({ ...value, ...nextPages }))
    return imported
  }

  useEffect(() => {
    if (!importRegionsRef) return
    importRegionsRef.current = importRegions
    return () => { importRegionsRef.current = null }
  })

  if (!loading && !sourceFiles.length) return <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Предпросмотр доступен только для PDF и картинок.</div>

  const baseWidth = Math.max(0, frameWidth - 2)
  const triggerPublish = (targetStatus?: 'checked' | 'revision') => { void publish(targetStatus) }
  const footerContent = typeof footer === 'function'
    ? footer({ publishing, published, triggerPublish })
    : footer

  const documentFooter = !readOnly && footerContent ? <div
    data-testid="review-document-footer"
    className="mx-auto w-full max-w-full rounded-2xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,.14)] outline outline-1 outline-black/10 sm:p-5"
  >
    <div className="space-y-4">
      {footerContent}
      {footerPublishLabel ? <div className="flex justify-end border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => triggerPublish()}
          disabled={publishing}
          className="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition-[transform,background-color] hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-50"
        >
          {publishing ? 'Публикую...' : published ? 'Опубликовать снова' : footerPublishLabel}
        </button>
      </div> : null}
    </div>
  </div> : null

  return <section className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-[0_1px_2px_rgba(0,0,0,.08),0_8px_24px_rgba(15,23,42,.08)]', className)}>
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
      {header ? <div className="min-w-0 flex-1">{header}</div> : <div className="flex-1" />}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600">
          <FileText size={13} className="text-slate-400" />
          <span className="min-w-14 text-center tabular-nums">{currentPage} / {pageCount}</span>
        </div>
        <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 px-1">
          <ToolButton disabled={zoom <= .6} title="Уменьшить" onClick={() => setZoom(z => Math.max(.6, z - .2))}><ZoomOut size={17}/></ToolButton>
          <span className="w-12 text-center text-xs font-semibold tabular-nums text-slate-600">{Math.round(zoom * 100)}%</span>
          <ToolButton disabled={zoom >= 2} title="Увеличить" onClick={() => setZoom(z => Math.min(2, z + .2))}><ZoomIn size={17}/></ToolButton>
        </div>
        {!readOnly && hasOtherAuthor && (
          <span
            data-testid="review-other-author"
            title="Очередь проверки общая для персонала курса. Ваше сохранение перезапишет страницу целиком — сверьтесь, прежде чем удалять чужие пометки."
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          >
            <AlertCircle size={12} />
            Работу уже смотрел другой преподаватель
          </span>
        )}
        {!readOnly && <div className="flex items-center gap-2">
          <SaveStatePill saving={saving} saveState={saveState} />
          {!hideToolbarPublish && <button type="button" data-testid="review-toolbar-publish-button" onClick={() => triggerPublish()} disabled={publishing} className="min-h-10 rounded-xl bg-emerald-600 px-3.5 text-sm font-medium text-white transition-[transform,background-color] hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-50">{publishing ? 'Публикую...' : published ? 'Опубликовать снова' : publishButtonLabel}</button>}
        </div>}
      </div>
    </div>
    {/* Строки задаём явно: у элементов грида min-height по умолчанию auto,
          и длинный список комментариев растягивал строку, а overflow-hidden
          снаружи просто обрезал её — прокрутка внутри становилась недостижимой.
          minmax(0,…) разрешает строке сжиматься, и внутренний overflow-auto
          снова работает. На узком экране колонка комментариев занимает нижние 45%. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,45%)] overflow-hidden xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[minmax(0,1fr)]">
      <div ref={frameRef} data-testid="review-document-scroll-area" className="min-h-0 overflow-auto p-3 sm:p-4">
        {error ? <div className="flex min-h-60 items-center justify-center rounded-xl bg-white text-sm text-red-600">{error}</div> :
        <div className="mx-auto flex min-h-full w-full flex-col gap-4">
          {surfaces.map(surface => {
            const key = pageKey(surface.filePath, surface.page)
            const pageData = pages[key] ?? EMPTY
            const shouldRender = visiblePages.has(surface.surfaceKey) || currentPage === surface.globalPage || draft?.filePath === surface.filePath && draft.page === surface.page
            const dragRect = dragState?.surfaceKey === surface.surfaceKey ? dragState.rect : null
            const edit = editPreview?.surfaceKey === surface.surfaceKey ? editPreview : null
            return <div
              key={surface.surfaceKey}
              ref={node => { pageRefs.current[surface.surfaceKey] = node }}
              data-page-number={surface.globalPage}
              data-surface-key={surface.surfaceKey}
              data-testid={`review-page-${surface.globalPage}`}
              className="relative"
            >
              {surface.kind === 'pdf'
                ? <PdfPageSurface
                    surface={surface}
                    pdf={pdfRefs.current[surface.filePath] ?? null}
                    pageData={pageData}
                    activeId={activeId}
                    selectedId={selectedId}
                    edit={edit}
                    onBeginRegionEdit={beginRegionEdit}
                    dragRect={dragRect}
                    shouldRender={shouldRender}
                    zoom={zoom}
                    frameWidth={baseWidth}
                    readOnly={readOnly}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onActivate={setActiveId}
                  />
                : <ImagePageSurface
                    surface={surface}
                    pageData={pageData}
                    activeId={activeId}
                    selectedId={selectedId}
                    edit={edit}
                    onBeginRegionEdit={beginRegionEdit}
                    dragRect={dragRect}
                    zoom={zoom}
                    frameWidth={baseWidth}
                    readOnly={readOnly}
                    loading={loading}
                    onLoaded={ratio => {
                      setImageRatios(current => ({ ...current, [surface.filePath]: ratio }))
                      setPageMetrics(current => ({ ...current, [pageKey(surface.filePath, 1)]: { width: ratio * 1000, height: 1000, ratio } }))
                      setLoading(false)
                    }}
                    onError={() => { setError('Не удалось открыть файл'); setLoading(false) }}
                    onPointerDown={pointerDown}
                    onPointerMove={pointerMove}
                    onPointerUp={pointerUp}
                    onActivate={setActiveId}
                  />
              }
            </div>
          })}
          {documentFooter}
        </div>}
      </div>
      <aside className="flex min-h-0 flex-col overflow-hidden border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
        <div data-testid="review-rail-scroll-zone" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {draft ? <CommentEditor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)}/> : <CommentList regions={regions} readOnly={readOnly} activeId={activeId} onActivate={activateRegion} onDelete={deleteRegion}/>}
        </div>
      </aside>
    </div>
  </section>
}

export default SubmissionReviewer

function ToolButton({ disabled, title, onClick, children }: { disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-[transform,background-color,color] hover:bg-white active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30">{children}</button>
}

/** Общие пропсы разметки: у PDF-страницы и картинки слой рамок одинаковый. */
type RegionLayerProps = {
  activeId: string | null
  selectedId: string | null
  edit: { id: string; rect: Rect } | null
  onBeginRegionEdit: (surface: DocumentSurface, region: Region, mode: 'move' | 'resize', handle: ResizeHandle | null, event: React.PointerEvent<SVGElement>) => void
  onActivate: (id: string | null) => void
}

function RegionLayer({ surface, pageData, readOnly, activeId, selectedId, edit, onBeginRegionEdit, onActivate }: RegionLayerProps & {
  surface: DocumentSurface
  pageData: PageData
  readOnly: boolean
}) {
  const aspect = surface.metrics?.ratio ?? 1 / 1.414
  return <>{pageData.objects.map(mark => <Shape
    key={mark.id}
    mark={mark}
    active={mark.id === activeId}
    selected={!readOnly && mark.id === selectedId}
    aspect={aspect}
    rectOverride={edit?.id === mark.id ? edit.rect : null}
    onActivate={() => isRegion(mark) && onActivate(mark.id)}
    onBeginEdit={readOnly ? undefined : (mode, handle, event) => {
      if (isRegion(mark)) onBeginRegionEdit(surface, mark, mode, handle, event)
    }}
  />)}</>
}

function PdfPageSurface({
  surface,
  pdf,
  pageData,
  activeId,
  selectedId,
  edit,
  onBeginRegionEdit,
  dragRect,
  shouldRender,
  zoom,
  frameWidth,
  readOnly,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
}: RegionLayerProps & {
  surface: DocumentSurface
  pdf: pdfjs.PDFDocumentProxy | null
  pageData: PageData
  dragRect: Rect | null
  shouldRender: boolean
  zoom: number
  frameWidth: number
  readOnly: boolean
  onPointerDown: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onActivate: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null)
  const width = frameWidth > 0 ? frameWidth * zoom : undefined
  const ratio = surface.metrics?.ratio ?? 1 / 1.414

  useEffect(() => {
    if (!pdf || !canvasRef.current || !surface.metrics || !shouldRender || !frameWidth) return
    let cancelled = false
    const metrics = surface.metrics
    pdf.getPage(surface.page).then(pdfPage => {
      if (cancelled || !canvasRef.current) return
      const baseScale = Math.max(0.1, (frameWidth - 2) / metrics.width)
      const viewport = pdfPage.getViewport({ scale: baseScale * zoom })
      const dpr = window.devicePixelRatio || 1
      const renderViewport = pdfPage.getViewport({ scale: baseScale * zoom * dpr })
      const canvas = canvasRef.current
      canvas.width = renderViewport.width
      canvas.height = renderViewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      renderTaskRef.current?.cancel()
      const task = pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: renderViewport })
      renderTaskRef.current = task
      task.promise.catch((error: any) => error?.name !== 'RenderingCancelledException' && undefined)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [frameWidth, pdf, shouldRender, surface.metrics, surface.page, zoom])

  return <div className="mx-auto" style={{ width: width ? `${width}px` : undefined, maxWidth: '100%' }}>
    <div className="relative overflow-hidden bg-white shadow-[0_2px_12px_rgba(15,23,42,.14)] outline outline-1 outline-black/10" style={{ aspectRatio: ratio }}>
      {shouldRender
        ? <canvas ref={canvasRef} className="block max-w-none" data-testid={`review-canvas-${surface.globalPage}`}/>
        : <div className="h-full w-full bg-white" data-testid={`review-placeholder-${surface.globalPage}`}/>}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        data-testid={`review-overlay-${surface.globalPage}`}
        className={cn('absolute inset-0 h-full w-full touch-none', readOnly ? 'cursor-default' : 'cursor-crosshair')}
        onPointerDown={event => onPointerDown(surface, event)}
        onPointerMove={event => onPointerMove(surface, event)}
        onPointerUp={event => onPointerUp(surface, event)}
        onPointerCancel={event => onPointerUp(surface, event)}
      >
        <RegionLayer surface={surface} pageData={pageData} readOnly={readOnly} activeId={activeId} selectedId={selectedId} edit={edit} onBeginRegionEdit={onBeginRegionEdit} onActivate={onActivate} />
        {dragRect && <rect x={dragRect.x} y={dragRect.y} width={dragRect.w} height={dragRect.h} fill={CATEGORIES.comment.color} fillOpacity={0.12} stroke={CATEGORIES.comment.color} strokeWidth={0.003} strokeDasharray="0.012 0.008"/>}
      </svg>
    </div>
  </div>
}

function ImagePageSurface({
  surface,
  pageData,
  activeId,
  selectedId,
  edit,
  onBeginRegionEdit,
  dragRect,
  zoom,
  frameWidth,
  readOnly,
  loading,
  onLoaded,
  onError,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
}: RegionLayerProps & {
  surface: DocumentSurface
  pageData: PageData
  dragRect: Rect | null
  zoom: number
  frameWidth: number
  readOnly: boolean
  loading: boolean
  onLoaded: (ratio: number) => void
  onError: () => void
  onPointerDown: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onPointerMove: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onPointerUp: (surface: DocumentSurface, event: React.PointerEvent<SVGSVGElement>) => void
  onActivate: (id: string | null) => void
}) {
  return (
    <div className="mx-auto" style={{ width: frameWidth > 0 ? `${frameWidth * zoom}px` : undefined, maxWidth: '100%' }}>
      <div className="relative overflow-hidden bg-white shadow-[0_2px_12px_rgba(15,23,42,.14)] outline outline-1 outline-black/10" style={{ aspectRatio: surface.metrics?.ratio ?? 1 / 1.414 }}>
        <img
          src={surface.url}
          alt="Работа ученика"
          draggable={false}
          className="block h-auto w-full select-none"
          onLoad={event => onLoaded(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          onError={onError}
        />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          data-testid={`review-overlay-${surface.globalPage}`}
          className={cn('absolute inset-0 h-full w-full touch-none', readOnly ? 'cursor-default' : 'cursor-crosshair')}
          onPointerDown={event => onPointerDown(surface, event)}
          onPointerMove={event => onPointerMove(surface, event)}
          onPointerUp={event => onPointerUp(surface, event)}
          onPointerCancel={event => onPointerUp(surface, event)}
        >
          <RegionLayer surface={surface} pageData={pageData} readOnly={readOnly} activeId={activeId} selectedId={selectedId} edit={edit} onBeginRegionEdit={onBeginRegionEdit} onActivate={onActivate} />
          {dragRect && <rect x={dragRect.x} y={dragRect.y} width={dragRect.w} height={dragRect.h} fill={CATEGORIES.comment.color} fillOpacity={0.12} stroke={CATEGORIES.comment.color} strokeWidth={0.003} strokeDasharray="0.012 0.008" />}
        </svg>
        {loading && <div className="absolute inset-0 flex min-h-60 items-center justify-center bg-white"><Loader2 className="animate-spin text-slate-400"/></div>}
      </div>
    </div>
  )
}

function Shape({ mark, active, selected = false, aspect = 1 / 1.414, rectOverride = null, onActivate, onBeginEdit }: {
  mark: Mark
  active: boolean
  selected?: boolean
  /** Отношение ширины страницы к высоте — нужно, чтобы ручки были квадратными. */
  aspect?: number
  /** Положение рамки прямо сейчас, пока её тянут (в объекте лежит ещё старое). */
  rectOverride?: Rect | null
  onActivate: () => void
  onBeginEdit?: (mode: 'move' | 'resize', handle: ResizeHandle | null, event: React.PointerEvent<SVGElement>) => void
}) {
  if (mark.type === 'region') {
    const category = CATEGORIES[mark.category]
    const rect = rectOverride ?? mark.rect
    const handleW = HANDLE_UNIT
    const handleH = HANDLE_UNIT * aspect
    // На узкой рамке серединные ручки слипаются с угловыми — тогда оставляем
    // только углы: восемь квадратиков на полоске в палец шириной не поймать.
    const showMidX = rect.w > handleW * 3.5
    const showMidY = rect.h > handleH * 3.5
    const handles: { handle: ResizeHandle; x: number; y: number }[] = [
      { handle: 'nw', x: rect.x, y: rect.y },
      { handle: 'ne', x: rect.x + rect.w, y: rect.y },
      { handle: 'se', x: rect.x + rect.w, y: rect.y + rect.h },
      { handle: 'sw', x: rect.x, y: rect.y + rect.h },
      ...(showMidX ? [
        { handle: 'n' as ResizeHandle, x: rect.x + rect.w / 2, y: rect.y },
        { handle: 's' as ResizeHandle, x: rect.x + rect.w / 2, y: rect.y + rect.h },
      ] : []),
      ...(showMidY ? [
        { handle: 'w' as ResizeHandle, x: rect.x, y: rect.y + rect.h / 2 },
        { handle: 'e' as ResizeHandle, x: rect.x + rect.w, y: rect.y + rect.h / 2 },
      ] : []),
    ]
    return <g>
      <rect
        x={rect.x} y={rect.y} width={rect.w} height={rect.h}
        fill={category.color} fillOpacity={active || selected ? 0.24 : 0.14}
        stroke={category.color} strokeWidth={active || selected ? 0.005 : 0.003}
        strokeDasharray={selected ? '0.012 0.008' : undefined}
        className={cn('transition-opacity', selected ? 'cursor-move' : 'cursor-pointer')}
        onPointerEnter={onActivate}
        onPointerDown={event => {
          if (onBeginEdit) onBeginEdit('move', null, event)
          else { event.stopPropagation(); onActivate() }
        }}
      />
      {selected && handles.map(item => <rect
        key={item.handle}
        data-testid={`region-handle-${item.handle}`}
        x={item.x - handleW / 2} y={item.y - handleH / 2}
        width={handleW} height={handleH}
        fill="#ffffff" stroke={category.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
        className={HANDLE_CURSOR[item.handle]}
        onPointerDown={event => onBeginEdit?.('resize', item.handle, event)}
      />)}
    </g>
  }
  if ('points' in mark) return <polyline points={mark.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.type === 'highlight' ? .38 : 1}/>
  if (mark.type === 'stamp') return <text x={mark.x} y={mark.y} fill={mark.color} fontSize={mark.size} textAnchor="middle" dominantBaseline="middle" fontWeight="700">{mark.value}</text>
  return <text x={mark.x} y={mark.y} fill={mark.color} fontSize={mark.size} dominantBaseline="hanging">{mark.text}</text>
}

function CommentEditor({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft | null>>; onSave: () => void; onCancel: () => void }) {
  const category = CATEGORIES[draft.category]
  const canSave = draft.category === 'praise' || draft.text.trim().length > 0
  return <div data-testid="comment-editor" className="flex flex-1 min-h-0 flex-col" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <MessageSquare size={13} className="text-slate-400" />
          Комментарий к области
        </div>
        <div className="mb-3 text-xs text-slate-400">Выберите категорию, затем при необходимости допишите комментарий.</div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CATEGORIES) as Category[]).map(value => {
            const item = CATEGORIES[value]
            return <button key={value} data-testid={`comment-category-${value}`} type="button" onClick={() => setDraft(current => current && { ...current, category: value })} className={cn('min-h-10 rounded-lg px-2 text-left text-xs font-medium transition-[transform,background-color,box-shadow] active:scale-[0.96]', draft.category === value ? `${item.bg} ring-2 ${item.ring}` : 'bg-slate-50 hover:bg-slate-100')}>
              <span className="mr-1 font-bold" style={{ color: item.color }}>{item.short}</span>{item.label}
            </button>
          })}
        </div>
      </div>
      {category.phrases.length > 0 && <div className="flex flex-wrap gap-2">
        {category.phrases.map(phrase => <button key={phrase} data-testid="comment-phrase-button" type="button" onClick={() => setDraft(current => current && { ...current, text: phrase })} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-[transform,background-color] hover:bg-slate-200 active:scale-[0.96]">{phrase}</button>)}
      </div>}
      <textarea data-testid="comment-editor-text" autoFocus aria-label="Текст комментария" value={draft.text} onChange={event => setDraft(current => current && { ...current, text: event.target.value })} placeholder={draft.category === 'praise' ? 'Можно оставить пустым' : 'Введите комментарий'} className="min-h-28 resize-none rounded-lg bg-slate-50 px-3 py-2 text-sm outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-blue-500"/>
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-3">
      <button data-testid="comment-editor-cancel" type="button" onClick={onCancel} className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-700 transition-[transform,background-color] hover:bg-slate-200 active:scale-[0.96]">Отмена</button>
      <button data-testid="comment-editor-save" type="button" onClick={onSave} disabled={!canSave} className="min-h-10 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition-[transform,background-color] hover:bg-slate-800 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40">Сохранить</button>
    </div>
  </div>
}

function CommentList({ regions, readOnly, activeId, onActivate, onDelete }: { regions: RegionItem[]; readOnly: boolean; activeId: string | null; onActivate: (item: RegionItem) => void; onDelete: (item: RegionItem) => void }) {
  const multiFile = new Set(regions.map(item => item.filePath)).size > 1
  return <div data-testid="comment-list" className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-14 items-center justify-between border-b border-slate-200 px-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MessageSquare size={15} className="text-slate-400" />
          Комментарии
        </div>
        <div className="mt-0.5 text-xs text-slate-400">{readOnly ? 'Только просмотр' : 'Клик открывает место в работе. Рамку можно перетащить, растянуть за уголки или подвинуть стрелками'}</div>
      </div>
      <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium tabular-nums text-slate-500">{regions.length}</div>
    </div>
    {regions.length ? <div className="min-h-0 flex-1 overflow-auto p-2">
      {regions.map(item => {
        const category = CATEGORIES[item.category]
        return <div data-testid="comment-list-item" key={item.id} onMouseEnter={() => onActivate(item)} className={cn('group mb-2 rounded-xl p-2.5 ring-1 transition-[background-color,box-shadow,transform]', activeId === item.id ? `${category.bg} ${category.ring} ring-2 shadow-sm` : 'bg-white ring-slate-200 hover:bg-slate-50 hover:shadow-sm')}>
          <button type="button" onClick={() => onActivate(item)} className="block w-full text-left">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="rounded-full px-1.5 py-0.5 font-bold text-white" style={{ backgroundColor: category.color }}>{category.short}</span>
              <span className="font-medium text-slate-700">{category.label}</span>
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 tabular-nums text-slate-500">стр. {item.globalPage}</span>
            </div>
            {multiFile && <div className="mb-1 text-[11px] text-slate-400">{item.fileLabel}, стр. {item.page}</div>}
            <div className="text-sm leading-5 text-slate-800">{item.text || '✓'}</div>
          </button>
          {!readOnly && <button type="button" aria-label="Удалить комментарий" title="Удалить комментарий" onClick={() => onDelete(item)} className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 opacity-100 transition-[transform,background-color,color] hover:bg-red-50 hover:text-red-600 active:scale-[0.96] sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={15}/></button>}
        </div>
      })}
    </div> : <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <MessageSquare size={18} />
      </div>
      <div className="text-sm font-medium text-slate-600">{readOnly ? 'Комментариев пока нет' : 'Здесь появятся комментарии к работе'}</div>
      <div className="max-w-56 text-xs leading-5 text-slate-400">{readOnly ? 'Для этой попытки опубликованных комментариев не найдено.' : 'Выделите область на документе, чтобы привязать к ней комментарий.'}</div>
    </div>}
  </div>
}
