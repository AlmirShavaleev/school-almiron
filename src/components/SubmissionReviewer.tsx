import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Save, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '@/lib/supabase'
import { extractStoragePath, getSignedFileUrl } from '@/lib/storage'
import { cn } from '@/utils/cn'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

type Category = 'comment' | 'calc' | 'logic' | 'format' | 'praise'
type Point = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }
type Region = { id: string; type: 'region'; rect: Rect; category: Category; text: string }
type Draft = { page: number; rect: Rect; category: Category; text: string }
type LegacyMark =
  | { id: string; type: 'stroke'; points: Point[]; color: string; width: number }
  | { id: string; type: 'highlight'; points: Point[]; color: string; width: number }
  | { id: string; type: 'stamp'; value: '✓' | '✕'; x: number; y: number; color: string; size: number }
  | { id: string; type: 'text'; text: string; x: number; y: number; color: string; size: number }
type Mark = Region | LegacyMark
type PageData = { version: 2; objects: Mark[] }
type Row = { page: number; data: unknown; status: 'draft' | 'published' }
type RegionItem = Region & { page: number }

interface Props { submissionId: string; filePath: string; readOnly?: boolean; className?: string; onPublish?: () => Promise<boolean | void>; onPublishComplete?: (success: boolean) => void }

const MIN_REGION_SIZE = 0.015
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

export function SubmissionReviewer({ submissionId, filePath, readOnly = false, className, onPublish, onPublishComplete }: Props) {
  const path = useMemo(() => extractStoragePath(filePath, 'homeworks') ?? filePath, [filePath])
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase()
  const isPdf = ext === 'pdf'
  const isImage = ['png', 'jpg', 'jpeg'].includes(ext ?? '')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
  const renderRef = useRef<pdfjs.RenderTask | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStart = useRef<Point | null>(null)

  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retried, setRetried] = useState(false)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [ratio, setRatio] = useState(1 / 1.414)
  const [pages, setPages] = useState<Record<number, PageData>>({})
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const current = pages[page] ?? EMPTY

  const regions = useMemo(() => Object.entries(pages)
    .flatMap(([number, data]) => data.objects.filter(isRegion).map(region => ({ ...region, page: Number(number) })))
    .sort((a, b) => a.page - b.page), [pages])

  const getUrl = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const next = await getSignedFileUrl('homeworks', path)
      if (!next) throw new Error('Файл не найден')
      setUrl(next)
    } catch (e: any) { setError(e?.message ?? 'Не удалось открыть файл'); setLoading(false) }
  }, [path])

  const retryUrl = useCallback(() => {
    if (retried) { setError('Не удалось загрузить файл'); setLoading(false); return }
    setRetried(true); void getUrl()
  }, [getUrl, retried])

  useEffect(() => { setRetried(false); void getUrl() }, [getUrl])

  useEffect(() => {
    let active = true
    const query = (supabase as any).from('annotation_sets').select('page,data,status')
      .eq('submission_id', submissionId).eq('file_path', path)
    if (readOnly) query.eq('status', 'published')
    query.then(({ data }: { data: Row[] | null }) => {
      if (!active) return
      const next: Record<number, PageData> = {}
      for (const row of data ?? []) next[row.page] = cleanData(row.data)
      setPages(next); setPublished((data ?? []).some(row => row.status === 'published'))
    })
    return () => { active = false }
  }, [path, readOnly, submissionId])

  useEffect(() => {
    if (!isPdf || !url) return
    let active = true
    const task = pdfjs.getDocument({ url })
    task.promise.then(doc => {
      if (!active) return
      pdfRef.current = doc; setPageCount(doc.numPages); setLoading(false)
    }).catch(() => active && retryUrl())
    return () => { active = false; renderRef.current?.cancel(); void task.destroy(); pdfRef.current = null }
  }, [isPdf, retryUrl, url])

  useEffect(() => {
    if (!isPdf || !pdfRef.current || !canvasRef.current) return
    let active = true
    pdfRef.current.getPage(page).then(pdfPage => {
      if (!active || !canvasRef.current) return
      const viewport = pdfPage.getViewport({ scale: 1.35 * zoom })
      const canvas = canvasRef.current
      canvas.width = viewport.width; canvas.height = viewport.height
      setRatio(viewport.width / viewport.height)
      renderRef.current?.cancel()
      const task = pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
      renderRef.current = task
      task.promise.catch((e: any) => e?.name !== 'RenderingCancelledException' && retryUrl())
    }).catch(retryUrl)
    return () => { active = false; renderRef.current?.cancel() }
  }, [isPdf, page, retryUrl, url, zoom])

  const savePage = useCallback(async (number: number, data: PageData) => {
    if (readOnly) return true
    setSaving(true); setSaveState('idle')
    const { error: saveError } = await (supabase as any).from('annotation_sets').upsert({
      submission_id: submissionId, file_path: path, page: number, data: { ...data, version: 2 }, status: 'draft',
    }, { onConflict: 'submission_id,file_path,page' })
    setSaving(false); setSaveState(saveError ? 'error' : 'saved')
    if (saveError) console.error('Не удалось сохранить аннотации', saveError)
    if (!saveError) {
      setPublished(false)
      setDirty(value => { const next = new Set(value); next.delete(number); return next })
    }
    return !saveError
  }, [path, readOnly, submissionId])

  useEffect(() => {
    if (readOnly || !dirty.size) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void Promise.all([...dirty].map(number => savePage(number, pages[number] ?? EMPTY)))
    }, 2000)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [dirty, pages, readOnly, savePage])

  function commit(number: number, next: PageData) {
    setPages(value => ({ ...value, [number]: { ...next, version: 2 } }))
    setDirty(value => new Set(value).add(number))
    setSaveState('idle')
  }
  const position = (event: React.PointerEvent): Point => {
    const rect = surfaceRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }
  function pointerDown(event: React.PointerEvent) {
    if (readOnly || draft) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = position(event)
    dragStart.current = point
    setDragRect({ x: point.x, y: point.y, w: 0, h: 0 })
  }
  function pointerMove(event: React.PointerEvent) {
    if (readOnly || !dragStart.current) return
    setDragRect(normalizeRect(dragStart.current, position(event)))
  }
  function pointerUp(event: React.PointerEvent) {
    if (readOnly || !dragStart.current) return
    const rect = normalizeRect(dragStart.current, position(event))
    dragStart.current = null
    setDragRect(null)
    if (rect.w < MIN_REGION_SIZE || rect.h < MIN_REGION_SIZE) return
    setDraft({ page, rect, category: 'comment', text: '' })
  }
  function saveDraft() {
    if (!draft) return
    const text = draft.text.trim()
    if (!text && draft.category !== 'praise') return
    const region: Region = { id: id(), type: 'region', rect: draft.rect, category: draft.category, text }
    const pageData = pages[draft.page] ?? EMPTY
    commit(draft.page, pageWithVersion([...pageData.objects, region]))
    setActiveId(region.id)
    setDraft(null)
  }
  function deleteRegion(item: RegionItem) {
    const pageData = pages[item.page] ?? EMPTY
    commit(item.page, pageWithVersion(pageData.objects.filter(mark => mark.id !== item.id)))
    if (activeId === item.id) setActiveId(null)
  }
  function activateRegion(item: RegionItem) {
    setPage(item.page)
    setActiveId(item.id)
  }
  async function publish() {
    setPublishing(true)
    if (onPublish && await onPublish() === false) { setPublishing(false); onPublishComplete?.(false); return }
    const numbers = new Set([...dirty, ...Object.keys(pages).map(Number)])
    const ok = await Promise.all([...numbers].map(number => savePage(number, pages[number] ?? EMPTY)))
    if (!ok.every(Boolean)) { setPublishing(false); onPublishComplete?.(false); return }
    const { error: publishError } = await (supabase as any).from('annotation_sets').update({ status: 'published' })
      .eq('submission_id', submissionId).eq('file_path', path)
    setSaveState(publishError ? 'error' : 'saved')
    setPublishing(false)
    if (publishError) { onPublishComplete?.(false); return }
    setPublished(true)
    onPublishComplete?.(true)
  }

  if (!isPdf && !isImage) return <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Предпросмотр доступен только для PDF, PNG и JPG.</div>

  return <section className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-[0_1px_2px_rgba(0,0,0,.08),0_8px_24px_rgba(15,23,42,.08)]', className)}>
    {!readOnly && <div className="flex flex-wrap items-center gap-2 bg-white p-2 shadow-[0_1px_0_rgba(15,23,42,.08)]">
      <div className="flex min-h-10 items-center gap-2 px-2 text-xs font-medium text-slate-600">
        <MessageSquare size={16}/>
        Выделите область мышкой
      </div>
      <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
        {saving ? <><Loader2 size={13} className="animate-spin"/>Сохраняю...</> : saveState === 'saved' ? <><Save size={13}/>Сохранено</> : saveState === 'error' ? <span className="text-red-600">Ошибка сохранения</span> : null}
        <button type="button" onClick={() => void publish()} disabled={publishing} className="min-h-10 rounded-lg bg-emerald-600 px-3 font-medium text-white transition-[transform,background-color] hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-50">{publishing ? 'Публикую...' : published ? 'Опубликовать снова' : 'Опубликовать проверку'}</button>
      </div>
    </div>}
    <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center"><ToolButton disabled={page <= 1} title="Назад" onClick={() => setPage(p => p - 1)}><ChevronLeft size={17}/></ToolButton><span className="min-w-20 text-center tabular-nums">{page} / {pageCount}</span><ToolButton disabled={page >= pageCount} title="Вперёд" onClick={() => setPage(p => p + 1)}><ChevronRight size={17}/></ToolButton></div>
      <div className="flex items-center"><ToolButton disabled={zoom <= .6} title="Уменьшить" onClick={() => setZoom(z => Math.max(.6, z - .2))}><ZoomOut size={17}/></ToolButton><span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span><ToolButton disabled={zoom >= 2} title="Увеличить" onClick={() => setZoom(z => Math.min(2, z + .2))}><ZoomIn size={17}/></ToolButton></div>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="overflow-auto p-3 sm:p-5">
        {error ? <div className="flex min-h-60 items-center justify-center rounded-xl bg-white text-sm text-red-600">{error}</div> :
        <div ref={surfaceRef} className="relative mx-auto overflow-hidden bg-white shadow-[0_2px_12px_rgba(15,23,42,.14)] outline outline-1 outline-black/10" style={{ width: isImage ? `${zoom * 100}%` : 'fit-content', aspectRatio: ratio }}>
          {isPdf ? <canvas ref={canvasRef} className="block max-w-none"/> : url ? <img src={url} alt="Работа ученика" draggable={false} className="block h-auto w-full select-none" onLoad={e => { setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); setLoading(false) }} onError={retryUrl}/> : null}
          {!loading && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className={cn('absolute inset-0 h-full w-full touch-none', readOnly ? 'cursor-default' : draft ? 'cursor-default' : 'cursor-crosshair')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
            {current.objects.map(mark => <Shape key={mark.id} mark={mark} active={mark.id === activeId} onActivate={() => isRegion(mark) && setActiveId(mark.id)}/>)}
            {dragRect && <rect x={dragRect.x} y={dragRect.y} width={dragRect.w} height={dragRect.h} fill={CATEGORIES.comment.color} fillOpacity={0.12} stroke={CATEGORIES.comment.color} strokeWidth={0.003} strokeDasharray="0.012 0.008"/>}
          </svg>}
          {loading && <div className="absolute inset-0 flex min-h-60 items-center justify-center bg-white"><Loader2 className="animate-spin text-slate-400"/></div>}
        </div>}
      </div>
      <aside className="flex min-h-64 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
        {draft ? <CommentEditor draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setDraft(null)}/> : <CommentList regions={regions} readOnly={readOnly} activeId={activeId} onActivate={activateRegion} onDelete={deleteRegion}/>}
      </aside>
    </div>
  </section>
}

export default SubmissionReviewer

function ToolButton({ disabled, title, onClick, children }: { disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-[transform,background-color,color] hover:bg-slate-100 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30">{children}</button>
}
function Shape({ mark, active, onActivate }: { mark: Mark; active: boolean; onActivate: () => void }) {
  if (mark.type === 'region') {
    const category = CATEGORIES[mark.category]
    return <rect x={mark.rect.x} y={mark.rect.y} width={mark.rect.w} height={mark.rect.h} fill={category.color} fillOpacity={active ? 0.24 : 0.14} stroke={category.color} strokeWidth={active ? 0.005 : 0.003} className="cursor-pointer transition-opacity" onPointerEnter={onActivate} onPointerDown={event => { event.stopPropagation(); onActivate() }}/>
  }
  if ('points' in mark) return <polyline points={mark.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.type === 'highlight' ? .38 : 1}/>
  if (mark.type === 'stamp') return <text x={mark.x} y={mark.y} fill={mark.color} fontSize={mark.size} textAnchor="middle" dominantBaseline="middle" fontWeight="700">{mark.value}</text>
  return <text x={mark.x} y={mark.y} fill={mark.color} fontSize={mark.size} dominantBaseline="hanging">{mark.text}</text>
}
function CommentEditor({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft | null>>; onSave: () => void; onCancel: () => void }) {
  const category = CATEGORIES[draft.category]
  const canSave = draft.category === 'praise' || draft.text.trim().length > 0
  return <div className="flex flex-1 min-h-0 flex-col" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
    {/* min-h-0 + overflow-y-auto so a tall editor (category grid + phrases +
        textarea) scrolls within its own panel instead of being clipped by
        the parent's overflow-hidden or chaining the scroll up into the
        surrounding modal. overscroll-contain stops that chaining outright. */}
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 flex flex-col gap-3">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Комментарий к области</div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CATEGORIES) as Category[]).map(value => {
            const item = CATEGORIES[value]
            return <button key={value} type="button" onClick={() => setDraft(current => current && { ...current, category: value })} className={cn('min-h-10 rounded-lg px-2 text-left text-xs font-medium transition-[transform,background-color,box-shadow] active:scale-[0.96]', draft.category === value ? `${item.bg} ring-2 ${item.ring}` : 'bg-slate-50 hover:bg-slate-100')}>
              <span className="mr-1 font-bold" style={{ color: item.color }}>{item.short}</span>{item.label}
            </button>
          })}
        </div>
      </div>
      {category.phrases.length > 0 && <div className="flex flex-wrap gap-2">
        {category.phrases.map(phrase => <button key={phrase} type="button" onClick={() => setDraft(current => current && { ...current, text: phrase })} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-[transform,background-color] hover:bg-slate-200 active:scale-[0.96]">{phrase}</button>)}
      </div>}
      <textarea autoFocus aria-label="Текст комментария" value={draft.text} onChange={event => setDraft(current => current && { ...current, text: event.target.value })} placeholder={draft.category === 'praise' ? 'Можно оставить пустым' : 'Введите комментарий'} className="min-h-28 resize-none rounded-lg bg-slate-50 px-3 py-2 text-sm outline-none ring-1 ring-slate-200 transition-shadow focus:ring-2 focus:ring-blue-500"/>
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 p-3">
      <button type="button" onClick={onCancel} className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-700 transition-[transform,background-color] hover:bg-slate-200 active:scale-[0.96]">Отмена</button>
      <button type="button" onClick={onSave} disabled={!canSave} className="min-h-10 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white transition-[transform,background-color] hover:bg-slate-800 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40">Сохранить</button>
    </div>
  </div>
}
function CommentList({ regions, readOnly, activeId, onActivate, onDelete }: { regions: RegionItem[]; readOnly: boolean; activeId: string | null; onActivate: (item: RegionItem) => void; onDelete: (item: RegionItem) => void }) {
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-12 items-center justify-between border-b border-slate-200 px-3">
      <div className="text-sm font-semibold text-slate-800">Комментарии</div>
      <div className="rounded-full bg-slate-100 px-2 py-1 text-xs tabular-nums text-slate-500">{regions.length}</div>
    </div>
    {regions.length ? <div className="min-h-0 flex-1 overflow-auto p-2">
      {regions.map(item => {
        const category = CATEGORIES[item.category]
        return <div key={item.id} onMouseEnter={() => onActivate(item)} className={cn('group mb-2 rounded-lg p-2 ring-1 transition-[background-color,box-shadow]', activeId === item.id ? `${category.bg} ${category.ring} ring-2` : 'bg-white ring-slate-200 hover:bg-slate-50')}>
          <button type="button" onClick={() => onActivate(item)} className="block w-full text-left">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="rounded-md px-1.5 py-0.5 font-bold text-white" style={{ backgroundColor: category.color }}>{category.short}</span>
              <span className="font-medium text-slate-700">{category.label}</span>
              <span className="ml-auto tabular-nums text-slate-400">стр. {item.page}</span>
            </div>
            <div className="text-sm text-slate-800">{item.text || '✓'}</div>
          </button>
          {!readOnly && <button type="button" aria-label="Удалить комментарий" title="Удалить комментарий" onClick={() => onDelete(item)} className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 opacity-100 transition-[transform,background-color,color] hover:bg-red-50 hover:text-red-600 active:scale-[0.96] sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={15}/></button>}
        </div>
      })}
    </div> : <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-slate-500">{readOnly ? 'Комментариев нет' : 'Выделите область на работе, чтобы добавить комментарий'}</div>}
  </div>
}
