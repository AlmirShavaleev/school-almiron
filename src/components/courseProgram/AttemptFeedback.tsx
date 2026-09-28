import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, PenLine } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { VerdictMark, MARK_OF_REVIEW_VERDICT } from '@/components/ui/VerdictMark'
import { extractStoragePath, getSignedFileUrl } from '@/lib/storage'
import { loadSignedPdf } from '@/hooks/useSignedPdf'
import { plural } from '@/lib/plural'
import { answersMatch } from '@/lib/reviewNotes'
import { rotateRatio, rotationDegrees, type Quarter } from '@/lib/pageRotation'
import type { ReviewTaskRow, ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'
import {
  bindFeedback,
  buildFeedbackLayout,
  cropBand,
  joinTaskNos,
  stripTaskPrefix,
  type FeedbackAnnotationRow,
  type FeedbackFile,
  type FeedbackPage,
  type FeedbackRegion,
  type FeedbackTask,
} from '@/lib/attemptFeedback'
import {
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  gradeScaleMax,
  isOverdue,
  type GradeScale,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkReviewRow,
} from '@/lib/topicHomework'
import { splitAnnotatableFiles } from './AttemptAnnotationOverlay'
import { cn } from '@/utils/cn'

/**
 * §239. «Разбор» проверенной попытки у ученика.
 *
 * Владелец: «ученики всё получают файлами, им неудобно понимать, где у них
 * ошибка наглядно». До §239 у попытки были чипы «IMG_…jpg» (голое фото без
 * пометок), жёлтая плашка комментария, таблица заданий и маленькая кнопка
 * «✏ Пометки учителя» — рамки учителя ученик видел, только если находил её.
 *
 * Здесь порядок другой — как в утверждённом макете: сначала что делать
 * (итог, светофор по заданиям, срок, кнопка пересдачи), потом слово учителя,
 * потом по каждому заданию — кусок СВОЕЙ страницы с рамкой учителя, потом
 * страницы работы целиком и общие замечания. Файлы ссылками не показываются:
 * скачать оригинал и PDF с разбором можно в просмотре страницы («Файлы»,
 * «Скачать PDF» §206) — он открывается с любой вырезки и миниатюры.
 *
 * Данные только те, что ученик и так читал: опубликованные рамки
 * (`annotation_sets`, RLS), таблица заданий после вердикта (§199), вердикт с
 * комментарием. Имя проверяющего — если RLS профилей его отдаёт; нет —
 * подпись «Учитель». Прав здесь никто не расширяет.
 */

const BUCKET = TOPIC_HOMEWORK_ATTEMPTS_BUCKET
const LAPTOP_QUERY = '(min-width: 1024px)'

const VERDICT_WORD: Record<ReviewTaskVerdict, string> = {
  correct: 'Верно',
  wrong: 'Неверно',
  partial: 'Частично',
  unchecked: 'Не сверено',
  unsolved: 'Не решено',
}

/** Плашки и значки заданий — палитра состояний v2 (`verdict.*`). */
const VERDICT_TONE: Record<ReviewTaskVerdict, { chip: string; ink: string }> = {
  correct: { chip: 'bg-verdict-ok-tint text-verdict-ok-ink', ink: 'text-verdict-ok-ink' },
  wrong: { chip: 'bg-verdict-bad-tint text-verdict-bad-ink', ink: 'text-verdict-bad-ink' },
  partial: { chip: 'bg-verdict-part-tint text-verdict-part-ink', ink: 'text-verdict-part-ink' },
  unchecked: { chip: 'bg-verdict-unk-tint text-verdict-unk-ink', ink: 'text-verdict-unk-ink' },
  unsolved: { chip: 'bg-verdict-none-tint text-verdict-none-ink', ink: 'text-verdict-none-ink' },
}

export interface OpenPageTarget {
  /** Сквозная страница работы — та же, что «стр. N». */
  page: number
  /** Рамка, к которой докрутить и которую подсветить. */
  regionId?: string
}

export interface AttemptFeedbackProps {
  homework: { title: string; due_at: string | null; grade_scale: GradeScale | null }
  attempt: TopicHomeworkAttemptRow
  review: TopicHomeworkReviewRow | null
  files: readonly TopicHomeworkAttemptFileRow[]
  /** Таблица проверки этой попытки (§199); пусто — таблицы нет. */
  rows: readonly ReviewTaskRow[]
  /** Пересдача: есть — кнопка «Исправить и сдать заново» (существующий поток). */
  resubmit?: { onClick: () => void; busy?: boolean; disabled?: boolean; title?: string } | null
  /** Строка под итогом вместо кнопки (например, новая попытка уже начата). */
  resubmitNote?: string | null
  /** «Авторское решение» — только после «Принято» и когда оно открыто. */
  solution?: { onOpen: () => void } | null
  /** «Вся страница →», миниатюра, вырезка — просмотр страницы с рамками. */
  onOpenPage: (target: OpenPageTarget) => void
  /** «Прошлые попытки» — рисует экран снаружи, стоят последними. */
  footer?: ReactNode
  /** Сегодня в формате YYYY-MM-DD — для тестов срока. */
  today?: string
}

// ─── данные ──────────────────────────────────────────────────────────────────

/** Опубликованные пометки попытки — ровно то, что аннотатор покажет ученику. */
function usePublishedAnnotations(attemptId: string) {
  const [rows, setRows] = useState<FeedbackAnnotationRow[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await (supabase as any)
          .from('annotation_sets')
          .select('file_path,page,data')
          .eq('attempt_id', attemptId)
          .eq('status', 'published')
        if (!cancelled) setRows(Array.isArray(data) ? data as FeedbackAnnotationRow[] : [])
      } catch {
        if (!cancelled) setRows([])
      }
    })()
    return () => { cancelled = true }
  }, [attemptId])
  return rows
}

/**
 * Имя проверяющего. Читается тем же клиентом под учеником, без новых прав:
 * отдала RLS профиль — имя, не отдала (или ошибка) — null, экран пишет
 * «Учитель». Отказ здесь ожидаем и не является ошибкой.
 */
function useReviewerName(reviewerId: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    setName(null)
    if (!reviewerId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await (supabase as any)
          .from('profiles')
          .select('full_name')
          .eq('id', reviewerId)
          .limit(1)
        const raw = Array.isArray(data) ? data[0]?.full_name : (data as { full_name?: unknown } | null)?.full_name
        if (!cancelled) setName(typeof raw === 'string' && raw.trim() ? raw.trim() : null)
      } catch {
        if (!cancelled) setName(null)
      }
    })()
    return () => { cancelled = true }
  }, [reviewerId])
  return name
}

/**
 * «Фамилия Имя Отчество» → «Имя Отчество»: к учителю в школе обращаются так,
 * и в макете сообщение подписано именно так. Два слова и меньше — как есть.
 */
export function teacherDisplayName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  return words.length >= 3 ? words.slice(1, 3).join(' ') : words.join(' ')
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('')
}

/** Сколько страниц в PDF работы — нужно сквозному счёту страниц. */
function usePdfPageCounts(paths: readonly string[], enabled: boolean): Record<string, number> {
  const key = paths.join('|')
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!enabled || !key) return
    let cancelled = false
    for (const path of key.split('|')) {
      loadSignedPdf(BUCKET, path)
        .then(doc => { if (!cancelled) setCounts(prev => (prev[path] === doc.numPages ? prev : { ...prev, [path]: doc.numPages })) })
        .catch(() => { /* счёт останется по размеченным страницам */ })
    }
    return () => { cancelled = true }
  }, [enabled, key])
  return counts
}

function useLaptopUp(): boolean {
  const [wide, setWide] = useState(() => {
    try { return typeof window.matchMedia === 'function' && window.matchMedia(LAPTOP_QUERY).matches } catch { return false }
  })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LAPTOP_QUERY)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])
  return wide
}

// ─── страница работы с рамками ───────────────────────────────────────────────

/** Один раз «подошла к экрану» — дальше грузится и остаётся. Без IO — сразу. */
function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (near) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect() }
    }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near]
}

function useBoxWidth<T extends HTMLElement>(ref: React.RefObject<T | null>, fixed?: number): number {
  const [width, setWidth] = useState(fixed ?? 0)
  useEffect(() => {
    if (fixed) { setWidth(fixed); return }
    const el = ref.current
    if (!el) return
    const apply = () => setWidth(Math.round(el.clientWidth) || 320)
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed, ref])
  return width
}

type WorkPageSize = 'thumb' | 'crop' | 'page'

/**
 * Страница работы с рамками учителя — целиком (миниатюра, левая колонка) или
 * полосой вокруг одной рамки (вырезка под заданием).
 *
 * Фото — подписанная ссылка; PDF — тот же pdf.js, что у аннотатора, через
 * общий кэш документов (`loadSignedPdf`), модуль грузится лениво. Поворот
 * страницы (§211) учитывается так же, как в аннотаторе: картинка крутится
 * CSS, PDF — углом вьюпорта, рамки — в долях ПОВЁРНУТОЙ страницы. Грузится,
 * только когда подошла к экрану; до того — серая заглушка нужной высоты.
 */
function WorkPage({
  file, page, quarter, regions, size, crop = null, fixedWidth, highlightId = null, label, onOpen, testId,
}: {
  file: FeedbackFile
  page: number
  quarter: Quarter
  regions: readonly FeedbackRegion[]
  size: WorkPageSize
  crop?: { top: number; height: number } | null
  fixedWidth?: number
  highlightId?: string | null
  label: string
  onOpen: () => void
  testId?: string
}) {
  const [boxRef, near] = useNearViewport<HTMLDivElement>()
  const width = useBoxWidth(boxRef, fixedWidth)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [url, setUrl] = useState<string | null>(null)
  /** Натуральное отношение сторон фото (ширина/высота) — до поворота. */
  const [imageRatio, setImageRatio] = useState(3 / 4)
  /** Отношение сторон PDF-страницы уже с поворотом. */
  const [pdfRatio, setPdfRatio] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!near || file.kind !== 'image') return
    let cancelled = false
    getSignedFileUrl(BUCKET, file.path)
      .then(signed => {
        if (cancelled) return
        if (signed) setUrl(signed)
        else setStatus('error')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [near, file.kind, file.path])

  useEffect(() => {
    if (!near || file.kind !== 'pdf' || !width) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    loadSignedPdf(BUCKET, file.path)
      .then(doc => doc.getPage(page))
      .then(pdfPage => {
        if (cancelled || !canvasRef.current) return
        const rotation = ((pdfPage.rotate ?? 0) + rotationDegrees(quarter)) % 360
        const base = pdfPage.getViewport({ scale: 1, rotation })
        setPdfRatio(base.width / base.height)
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
        const viewport = pdfPage.getViewport({ scale: (width / base.width) * dpr, rotation })
        const canvas = canvasRef.current
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no canvas')
        task = pdfPage.render({ canvas, canvasContext: ctx, viewport }) as unknown as typeof task
        return task!.promise
      })
      .then(() => { if (!cancelled) setStatus('ready') })
      .catch((e: unknown) => {
        if (cancelled || (e as { name?: string })?.name === 'RenderingCancelledException') return
        setStatus('error')
      })
    return () => { cancelled = true; task?.cancel() }
  }, [near, file.kind, file.path, page, quarter, width])

  const ratio = file.kind === 'pdf'
    ? (pdfRatio ?? rotateRatio(1 / 1.414, quarter))
    : rotateRatio(imageRatio, quarter)
  const pageHeight = width > 0 ? width / ratio : 0
  const boxHeight = crop ? crop.height * pageHeight : pageHeight
  const innerTop = crop ? -crop.top * pageHeight : 0

  if (status === 'error') {
    const what = crop ? 'фрагмент' : 'страницу'
    return (
      <div
        data-testid={testId ? `${testId}-error` : undefined}
        className={cn(
          'rounded-xl bg-graphite-50 px-3 py-2.5 text-xs text-graphite-500',
          size === 'thumb' && 'flex h-[200px] w-[150px] flex-col justify-center',
        )}
      >
        Не удалось показать {what} ·{' '}
        <button type="button" onClick={onOpen} className="font-bold text-primary-600 hover:underline">
          Открыть страницу
        </button>
      </div>
    )
  }

  const thumb = size === 'thumb'
  const oddQuarter = quarter % 2 === 1
  return (
    <div ref={boxRef} style={fixedWidth ? { width: fixedWidth } : undefined} className={cn(!fixedWidth && 'w-full')}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        data-testid={testId}
        data-status={status}
        className={cn(
          'relative block w-full cursor-zoom-in overflow-hidden bg-graphite-100 text-left',
          'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-gold-300',
          thumb ? 'rounded-xl shadow-[0_1px_2px_rgba(20,32,61,.08),0_4px_12px_rgba(20,32,61,.08)]' : 'rounded-xl ring-1 ring-graphite-200',
        )}
        style={{ height: boxHeight || (thumb ? 200 : crop ? 90 : 360) }}
      >
        <div className="absolute inset-x-0" style={{ top: innerTop, height: pageHeight }}>
          {file.kind === 'image' && url && (
            <img
              src={url}
              alt=""
              draggable={false}
              className={cn(
                'absolute block max-w-none select-none transition-opacity',
                status === 'ready' ? 'opacity-100' : 'opacity-0',
                quarter === 0 ? 'inset-0 h-full w-full' : 'left-1/2 top-1/2',
              )}
              style={quarter === 0 ? undefined : {
                width: oddQuarter ? `${imageRatio * 100}%` : '100%',
                height: oddQuarter ? `${100 / imageRatio}%` : '100%',
                transform: `translate(-50%, -50%) rotate(${rotationDegrees(quarter)}deg)`,
              }}
              onLoad={e => {
                const img = e.currentTarget
                if (img.naturalWidth > 0 && img.naturalHeight > 0) setImageRatio(img.naturalWidth / img.naturalHeight)
                setStatus('ready')
              }}
              onError={() => setStatus('error')}
            />
          )}
          {file.kind === 'pdf' && (
            <canvas
              ref={canvasRef}
              className={cn('absolute inset-0 block h-full w-full', status === 'ready' ? 'opacity-100' : 'opacity-0')}
            />
          )}
          {status === 'ready' && regions.map(region => (
            <FrameMark key={region.id} region={region} thumb={thumb} highlighted={highlightId === region.id} />
          ))}
        </div>
        {status !== 'ready' && <span aria-hidden className="absolute inset-0 animate-pulse bg-graphite-100" />}
      </button>
    </div>
  )
}

/** Рамка учителя с номером пометки — в долях страницы, HTML поверх картинки. */
function FrameMark({ region, thumb, highlighted }: { region: FeedbackRegion; thumb: boolean; highlighted: boolean }) {
  const r = region.displayRect
  return (
    <span
      data-testid="feedback-frame"
      data-region={region.id}
      className={cn(
        'pointer-events-none absolute rounded-[3px]',
        highlighted && 'animate-[pulse_1s_ease-in-out_2] outline outline-[3px] outline-offset-2 outline-gold-300',
      )}
      style={{
        left: `${r.x * 100}%`,
        top: `${r.y * 100}%`,
        width: `${r.w * 100}%`,
        height: `${r.h * 100}%`,
        border: `${thumb ? 1.5 : 2.5}px solid ${region.color}`,
        backgroundColor: `${region.color}1f`,
      }}
    >
      <span
        className={cn(
          'absolute flex items-center justify-center rounded-full font-extrabold leading-none text-white',
          thumb ? '-right-[7px] -top-[7px] h-3.5 w-3.5 text-[8px]' : '-right-2.5 -top-2.5 h-5 w-5 text-[11px]',
        )}
        style={{ backgroundColor: region.color }}
      >
        {region.number}
      </span>
    </span>
  )
}

// ─── сам разбор ──────────────────────────────────────────────────────────────

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** «пт, 18 сентября» — день срока без сдвига пояса (как `formatDue`). */
function dueLabel(dueAt: string): string {
  const [y, m, d] = dueAt.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
}

function taskAnchor(attemptId: string, key: string): string {
  return `hw-fb-${attemptId}-${key.replace(/[^\p{L}\p{N}]+/gu, '_')}`
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-0.5 pt-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-graphite-500">{children}</h3>
  )
}

function summaryLine(rows: readonly ReviewTaskRow[]): string {
  const count = (v: ReviewTaskVerdict) => rows.filter(r => r.verdict === v).length
  const parts: string[] = []
  const correct = count('correct')
  if (correct) parts.push(`${correct} ${plural(correct, 'задание', 'задания', 'заданий')} верно`)
  if (count('partial')) parts.push(`${count('partial')} частично`)
  if (count('wrong')) parts.push(`${count('wrong')} неверно`)
  if (count('unsolved')) parts.push(`${count('unsolved')} не решено`)
  return parts.join(', ')
}

export function AttemptFeedback({
  homework, attempt, review, files, rows, resubmit, resubmitNote, solution, onOpenPage, footer, today,
}: AttemptFeedbackProps) {
  const accepted = attempt.status === 'accepted'
  const annotationRows = usePublishedAnnotations(attempt.id)
  const reviewerName = useReviewerName(review?.reviewer_id)
  const laptopUp = useLaptopUp()

  /** Файлы в том порядке и того вида, как их листает аннотатор. */
  const feedbackFiles = useMemo<FeedbackFile[]>(() => splitAnnotatableFiles([...files]).annotatable.map(f => {
    const path = extractStoragePath(f.storage_path, BUCKET) ?? f.storage_path
    const isPdf = /\.pdf$/i.test(path.split('?')[0]) || f.mime_type === 'application/pdf'
    return { path, kind: isPdf ? 'pdf' : 'image' }
  }), [files])
  const pdfPaths = useMemo(() => feedbackFiles.filter(f => f.kind === 'pdf').map(f => f.path), [feedbackFiles])
  const pdfCounts = usePdfPageCounts(pdfPaths, annotationRows.length > 0)

  const layout = useMemo(
    () => buildFeedbackLayout(feedbackFiles, annotationRows, pdfCounts),
    [feedbackFiles, annotationRows, pdfCounts],
  )
  const binding = useMemo(() => bindFeedback([...rows], layout.regions), [rows, layout.regions])
  const hasPages = layout.regions.length > 0
  const fileOf = useCallback((page: FeedbackPage): FeedbackFile => feedbackFiles[page.fileIndex], [feedbackFiles])
  const pageOf = useCallback(
    (globalPage: number) => layout.pages.find(p => p.globalPage === globalPage) ?? null,
    [layout.pages],
  )
  const regionsOnPage = useCallback(
    (globalPage: number) => layout.regions.filter(r => r.globalPage === globalPage),
    [layout.regions],
  )

  const [okOpen, setOkOpen] = useState(false)
  const [flashTask, setFlashTask] = useState<string | null>(null)
  const [flashRegion, setFlashRegion] = useState<string | null>(null)
  useEffect(() => {
    if (!flashTask && !flashRegion) return
    const t = window.setTimeout(() => { setFlashTask(null); setFlashRegion(null) }, 1400)
    return () => window.clearTimeout(t)
  }, [flashTask, flashRegion])

  // Левая колонка (с 1024): страницы работы со своей прокруткой.
  const leftRef = useRef<HTMLDivElement>(null)
  const leftPageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const scrollLeftTo = useCallback((region: FeedbackRegion) => {
    const box = leftRef.current
    const pageEl = leftPageRefs.current[region.globalPage]
    if (!box || !pageEl) return
    const top = Math.max(0, pageEl.offsetTop + region.displayRect.y * pageEl.offsetHeight - 48)
    if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: 'smooth' })
    else box.scrollTop = top
    setFlashRegion(region.id)
  }, [])

  function goToTask(task: FeedbackTask) {
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (task.row.verdict === 'correct') setOkOpen(true)
    setFlashTask(task.key)
    window.requestAnimationFrame(() => {
      document.getElementById(taskAnchor(attempt.id, task.key))
        ?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    })
    if (laptopUp && task.regions[0]) scrollLeftTo(task.regions[0])
  }

  const openRegion = (region: FeedbackRegion) => onOpenPage({ page: region.globalPage, regionId: region.id })

  // ── итог ──
  const reviewedOn = shortDate(review?.created_at ?? attempt.updated_at)
  const scoreMax = gradeScaleMax(homework.grade_scale)
  const showGrade = accepted && !!homework.grade_scale && review?.score != null
  const headline = binding.toFix > 0
    ? `Исправь ${binding.toFix} ${plural(binding.toFix, 'задание', 'задания', 'заданий')} и пришли заново`
    : 'Работа на доработке'
  const showDue = !accepted && !!homework.due_at && !isOverdue(homework.due_at, today)
  const displayName = reviewerName ? teacherDisplayName(reviewerName) : null

  const chips = binding.tasks.length > 0 && (
    <div className="flex flex-wrap gap-1.5" aria-label="Задания">
      {binding.tasks.map(task => (
        <button
          key={task.row.id}
          type="button"
          data-testid="feedback-chip"
          data-no={task.row.no}
          data-verdict={task.row.verdict}
          aria-label={`Задание ${task.row.no}: ${VERDICT_WORD[task.row.verdict].toLowerCase()}`}
          onClick={() => goToTask(task)}
          className={cn(
            'inline-flex min-h-8 items-center gap-1.5 rounded-xl px-2.5 py-1 text-[13px] font-bold transition-transform active:scale-[0.97]',
            'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-gold-300',
            VERDICT_TONE[task.row.verdict].chip,
          )}
        >
          <VerdictMark state={MARK_OF_REVIEW_VERDICT[task.row.verdict]} size={16} label={null} />
          №{task.row.no}
        </button>
      ))}
    </div>
  )

  const hero = (
    <div
      data-testid="feedback-hero"
      className={cn(
        'flex flex-col gap-3 rounded-[22px] border-2 p-4',
        accepted ? 'border-[#9fd6ad] bg-gradient-to-br from-verdict-ok-tint via-white to-white' : 'border-gold-300 bg-white',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-graphite-500">
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
          accepted ? 'bg-verdict-ok-tint text-verdict-ok-ink' : 'bg-gold-50 text-gold-700',
        )}
        >
          {accepted ? '✓ Принято' : '↻ На доработке'}
        </span>
        <span>
          <span>Попытка №{attempt.attempt_number}</span>
          {reviewedOn && <> · проверено {reviewedOn}</>}
        </span>
      </div>

      {accepted ? (
        showGrade ? (
          <div data-testid="feedback-score" className="flex items-baseline gap-2.5 text-primary-900">
            <span className="text-[38px] font-extrabold leading-none tabular-nums">{review!.score}</span>
            {scoreMax != null && <span className="text-[17px] font-extrabold text-graphite-500">из {scoreMax}</span>}
          </div>
        ) : (
          <p data-testid="feedback-headline" className="text-[21px] font-extrabold leading-tight text-primary-900">Работа принята</p>
        )
      ) : (
        <p data-testid="feedback-headline" className="text-[21px] font-extrabold leading-tight text-primary-900 [text-wrap:balance]">{headline}</p>
      )}

      {chips}
      {accepted && binding.tasks.length > 0 && (
        <p className="text-[12.5px] text-graphite-500">{summaryLine(rows)}</p>
      )}

      {showDue && (
        <p data-testid="feedback-due" className="text-[13px] text-graphite-500">
          Пересдать до <b className="font-bold text-gold-700">{dueLabel(homework.due_at!)}</b>
        </p>
      )}

      {!accepted && resubmit && (
        <Button
          data-testid="hw-resubmit"
          className="w-full"
          onClick={resubmit.onClick}
          loading={resubmit.busy}
          disabled={resubmit.disabled}
          title={resubmit.title}
        >
          Исправить и сдать заново
        </Button>
      )}
      {!accepted && !resubmit && resubmitNote && (
        <p className="text-[13px] text-graphite-600">{resubmitNote}</p>
      )}
    </div>
  )

  const message = review?.comment?.trim() ? (
    <div data-testid="feedback-message" className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-2.5">
      <span
        aria-hidden
        className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary-900 text-[13px] font-extrabold text-white"
      >
        {displayName ? initialsOf(displayName) : 'У'}
      </span>
      <div className="min-w-0 rounded-[4px_18px_18px_18px] bg-graphite-50 px-3 py-2.5 ring-1 ring-graphite-200/70">
        <div data-testid="feedback-reviewer" className="mb-0.5 text-[11.5px] font-semibold text-graphite-500">
          {displayName ? `${displayName} · учитель` : 'Учитель'}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-graphite-900">{review!.comment!.trim()}</p>
      </div>
    </div>
  ) : null

  const solutionRow = accepted && solution ? (
    <button
      type="button"
      data-testid="feedback-solution"
      onClick={solution.onOpen}
      className="flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left ring-1 ring-graphite-200 transition-colors hover:ring-primary-300"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-50 text-primary-600">
        <PenLine size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-bold text-graphite-900">Авторское решение</b>
        <small className="block text-xs text-graphite-500">Открылось после принятия работы</small>
      </span>
      <ChevronRight size={18} className="shrink-0 text-graphite-400" />
    </button>
  ) : null

  const taskCard = (task: FeedbackTask) => {
    const { row } = task
    const tone = VERDICT_TONE[row.verdict]
    const student = String(row.student_answer ?? '').trim()
    const expected = String(row.expected_answer ?? '').trim()
    const sameAnswer = !!student && !!expected && answersMatch(student, expected)
    return (
      <article
        key={row.id}
        id={taskAnchor(attempt.id, task.key)}
        data-testid="feedback-task"
        data-no={row.no}
        data-verdict={row.verdict}
        onClick={laptopUp && task.regions[0] ? () => scrollLeftTo(task.regions[0]) : undefined}
        className={cn(
          'scroll-mt-20 overflow-hidden rounded-[18px] bg-white ring-1 ring-graphite-200 shadow-[0_1px_2px_rgba(20,32,61,.05),0_4px_14px_rgba(20,32,61,.05)] transition-shadow',
          flashTask === task.key && 'ring-[3px] ring-gold-300',
          laptopUp && task.regions[0] && 'lg:cursor-pointer',
        )}
      >
        <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
          <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-[9px] px-1 text-[13px] font-extrabold', tone.chip)}>{row.no}</span>
          <span className={cn('text-xs font-bold', tone.ink)}>{VERDICT_WORD[row.verdict]}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 px-3.5">
          <div className="min-w-0 rounded-[10px] bg-graphite-50 px-2.5 py-1.5 text-xs text-graphite-500">
            Твой ответ
            <b data-testid="feedback-answer-student" className="block break-words text-sm font-bold text-graphite-900">{student || '—'}</b>
          </div>
          {accepted ? (
            <div className="min-w-0 rounded-[10px] bg-graphite-50 px-2.5 py-1.5 text-xs text-graphite-500">
              Верный ответ
              <b data-testid="feedback-answer-expected" className="block break-words text-sm font-bold text-graphite-900">{expected || '—'}</b>
            </div>
          ) : row.verdict === 'partial' && sameAnswer ? (
            <div className="min-w-0 rounded-[10px] bg-graphite-50 px-2.5 py-1.5 text-xs text-graphite-500">
              Ответ
              <b className="block text-sm font-bold text-graphite-900">верный</b>
            </div>
          ) : (
            <div data-testid="feedback-answer-locked" className="min-w-0 rounded-[10px] bg-graphite-50 px-2.5 py-1.5 text-xs text-graphite-500">
              Верный ответ
              <b className="block text-[12.5px] font-semibold text-graphite-400">после пересдачи</b>
            </div>
          )}
        </div>
        {task.note && (
          <p data-testid="feedback-task-note" className="px-3.5 pt-2.5 text-[13.5px] leading-normal text-graphite-900">{task.note}</p>
        )}
        {task.regions.map(region => {
          const page = pageOf(region.globalPage)
          return (
            <div key={region.id}>
              {region.text.trim() && (
                <p data-testid="feedback-task-note" className="px-3.5 pt-2.5 text-[13.5px] leading-normal text-graphite-900">
                  {stripTaskPrefix(region.text)}
                </p>
              )}
              {page && (
                <div className="mx-3.5 mt-2 lg:hidden">
                  <WorkPage
                    file={fileOf(page)}
                    page={page.page}
                    quarter={page.quarter}
                    regions={[region]}
                    size="crop"
                    crop={cropBand(region.displayRect)}
                    label={`Открыть страницу ${region.globalPage} с пометкой ${region.number}`}
                    onOpen={() => openRegion(region)}
                    testId="feedback-crop"
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-3.5 pb-3 pt-2 text-xs text-graphite-500">
                <span>Пометка {region.number} · стр. {region.globalPage}</span>
                <button
                  type="button"
                  data-testid="feedback-open-page"
                  onClick={e => { e.stopPropagation(); openRegion(region) }}
                  className="font-bold text-primary-600 hover:underline"
                >
                  Вся страница →
                </button>
              </div>
            </div>
          )
        })}
        {task.regions.length === 0 && <div className="h-3" />}
      </article>
    )
  }

  const correctBlock = binding.correct.length > 0 ? (
    <div data-testid="feedback-correct" className="overflow-hidden rounded-2xl bg-white ring-1 ring-graphite-200">
      <div className="flex items-center gap-2.5 px-3.5 py-3 text-[13.5px] text-graphite-900">
        <span className={cn('inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-[13px] font-bold', VERDICT_TONE.correct.chip)}>
          <VerdictMark state="ok" size={16} label={null} />
          {binding.correct.length}
        </span>
        <span className="min-w-0 flex-1">
          {joinTaskNos(binding.correct.map(t => t.row.no))} {binding.correct.length === 1 ? 'засчитано' : 'засчитаны'}
        </span>
        <button
          type="button"
          aria-expanded={okOpen}
          onClick={() => setOkOpen(v => !v)}
          className="shrink-0 text-xs font-bold text-primary-600 hover:underline"
        >
          {okOpen ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {okOpen && (
        <ul>
          {binding.correct.map(task => (
            <li
              key={task.row.id}
              id={taskAnchor(attempt.id, task.key)}
              data-testid="feedback-correct-row"
              className={cn(
                'flex scroll-mt-20 items-center gap-2.5 border-t border-graphite-100 px-3.5 py-2 text-[13px]',
                flashTask === task.key && 'bg-gold-50',
              )}
            >
              <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-[9px] px-1 text-[13px] font-extrabold', VERDICT_TONE.correct.chip)}>{task.row.no}</span>
              <span className="min-w-0 flex-1 break-words text-graphite-900">{String(task.row.student_answer ?? '').trim() || '—'}</span>
              <span className="shrink-0 text-xs font-bold text-verdict-ok-ink">верно</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null

  const tasksSection = binding.tasks.length > 0 ? (
    <>
      <SectionLabel>{accepted ? 'По заданиям' : 'Что исправить'}</SectionLabel>
      {binding.cards.map(taskCard)}
      {correctBlock}
    </>
  ) : null

  const pagesStrip = hasPages ? (
    <div className="flex flex-col gap-2 lg:hidden">
      <SectionLabel>Твоя работа с пометками</SectionLabel>
      <div data-testid="feedback-pages" className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1">
        {layout.pages.map(page => {
          const own = regionsOnPage(page.globalPage)
          return (
            <div key={page.globalPage} className="shrink-0 snap-start">
              <WorkPage
                file={fileOf(page)}
                page={page.page}
                quarter={page.quarter}
                regions={own}
                size="thumb"
                fixedWidth={150}
                label={`Открыть страницу ${page.globalPage}`}
                onOpen={() => onOpenPage({ page: page.globalPage })}
                testId="feedback-page-thumb"
              />
              <span className="mt-1.5 block text-[11.5px] text-graphite-500">
                Стр. {page.globalPage}{own.length > 0 && ` · ${own.length} ${plural(own.length, 'пометка', 'пометки', 'пометок')}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  ) : null

  const generalSection = binding.general.length > 0 ? (
    <>
      <SectionLabel>Общие замечания</SectionLabel>
      <ul className="flex flex-col gap-2">
        {binding.general.map(({ region, taskNo }) => (
          <li key={region.id}>
            <button
              type="button"
              data-testid="feedback-general-item"
              data-praise={region.praise ? 'true' : undefined}
              onClick={() => (laptopUp ? scrollLeftTo(region) : openRegion(region))}
              className="flex w-full items-start gap-2.5 rounded-[14px] bg-white px-3 py-2.5 text-left text-[13px] ring-1 ring-graphite-200 transition-colors hover:ring-primary-300"
            >
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ backgroundColor: region.color }}
              >
                {region.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-graphite-900">{region.text.trim() || (region.praise ? 'Хорошо' : 'Замечание')}</span>
                <small className="block text-xs text-graphite-500">
                  {taskNo ? `№${taskNo} · ` : ''}стр. {region.globalPage}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  ) : null

  return (
    <section
      data-testid="attempt-feedback"
      data-state={accepted ? 'accepted' : 'returned'}
      aria-label="Разбор работы"
      className={cn('mt-4', hasPages && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6')}
    >
      {hasPages && (
        <aside className="hidden lg:sticky lg:top-20 lg:block" aria-label="Твоя работа с пометками">
          <div ref={leftRef} data-testid="feedback-pages-column" className="relative flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto pr-1">
            <SectionLabel>Твоя работа с пометками</SectionLabel>
            {layout.pages.map(page => (
              <div key={page.globalPage} ref={node => { leftPageRefs.current[page.globalPage] = node }}>
                <WorkPage
                  file={fileOf(page)}
                  page={page.page}
                  quarter={page.quarter}
                  regions={regionsOnPage(page.globalPage)}
                  size="page"
                  highlightId={flashRegion}
                  label={`Открыть страницу ${page.globalPage}`}
                  onOpen={() => onOpenPage({ page: page.globalPage })}
                  testId="feedback-page-full"
                />
                <span className="mt-1 block text-[11.5px] text-graphite-500">Стр. {page.globalPage}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
      {/* Без страниц колонка одна — на широком экране не растягиваем её в строку на 960 px. */}
      <div className={cn('flex min-w-0 flex-col gap-3', !hasPages && 'max-w-2xl')}>
        {hero}
        {message}
        {solutionRow}
        {tasksSection}
        {pagesStrip}
        {generalSection}
        {footer}
      </div>
    </section>
  )
}
