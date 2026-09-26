import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { PdfPageView } from '@/components/pdf/PdfPageView'
import { useSignedPdf } from '@/hooks/useSignedPdf'
import { MOCK_EXAMS_BUCKET } from '@/lib/mockExamLesson'
import { cn } from '@/utils/cn'

/**
 * §229. Задания пробника прямо на странице ученика (экран 6 макета): страницы
 * PDF условия его варианта — по одной, с листанием (кнопки, стрелки, свайп) и
 * увеличением. Файл выдаёт хранилище по серверному времени и только своего
 * варианта (`mock_exam_file_readable`); не вышло показать страницами —
 * ссылка «Открыть PDF» остаётся всегда. Другой файл — другой `key` у
 * вызывающего: листание начинается заново.
 */
const ZOOMS = [1, 1.5, 2, 3]

export function ConditionViewer({ path, title }: { path: string; title: string }) {
  const pdf = useSignedPdf(MOCK_EXAMS_BUCKET, path, { sensitive: true })
  const [page, setPage] = useState(1)
  const [zoomAt, setZoomAt] = useState(0)
  const zoom = ZOOMS[zoomAt]
  const pages = pdf.status === 'ready' ? pdf.pages : 0
  const touch = useRef<{ x: number; y: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const go = (d: number) => setPage(p => Math.min(Math.max(1, p + d), Math.max(1, pages)))
  // Новая страница — с её начала.
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0, left: 0 }) }, [page])

  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-testid="mock-lesson-tasks" aria-label="Задания">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-graphite-900">{title}</h2>
        <SignedFileLink bucket={MOCK_EXAMS_BUCKET} url={path} sensitive className="inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-primary-600 hover:underline">
          <span data-testid="mock-lesson-condition" className="inline-flex items-center gap-1"><ExternalLink size={13} aria-hidden />Открыть PDF</span>
        </SignedFileLink>
      </div>
      {pdf.status === 'ready' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-graphite-500" data-testid="mock-lesson-pages-bar">
          <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => go(-1)} disabled={page <= 1} aria-label="Предыдущая страница"
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-primary-50 disabled:opacity-40 sm:h-8 sm:w-8"><ChevronLeft size={18} /></button>
            <span className="min-w-[88px] text-center font-semibold text-graphite-900" aria-live="polite" data-testid="mock-lesson-page-no">стр. {page} из {pages}</span>
            <button type="button" onClick={() => go(1)} disabled={page >= pages} aria-label="Следующая страница" data-testid="mock-lesson-page-next"
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-primary-50 disabled:opacity-40 sm:h-8 sm:w-8"><ChevronRight size={18} /></button>
          </span>
          <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setZoomAt(z => Math.max(0, z - 1))} disabled={zoomAt === 0} aria-label="Мельче"
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-primary-50 disabled:opacity-40 sm:h-8 sm:w-8"><ZoomOut size={16} /></button>
            <button type="button" onClick={() => setZoomAt(0)} className="min-w-[3.25rem] rounded-full px-1.5 py-1 hover:bg-primary-50" title="По ширине" data-testid="mock-lesson-zoom">{Math.round(zoom * 100)} %</button>
            <button type="button" onClick={() => setZoomAt(z => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomAt === ZOOMS.length - 1} aria-label="Крупнее"
              className="grid h-10 w-10 place-items-center rounded-full hover:bg-primary-50 disabled:opacity-40 sm:h-8 sm:w-8"><ZoomIn size={16} /></button>
          </span>
        </div>
      )}
      <div
        ref={scroller}
        className={cn('max-h-[72vh] overflow-auto rounded-[14px] bg-graphite-50 p-1.5 lg:max-h-[calc(100vh-240px)]', pdf.status !== 'ready' && 'grid min-h-[200px] place-items-center')}
        tabIndex={0}
        aria-label={pages ? `Страница ${page} из ${pages}. Стрелки влево и вправо — листать` : 'Задания'}
        onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1) } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) } }}
        onTouchStart={e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }}
        onTouchEnd={e => {
          const s = touch.current
          touch.current = null
          if (!s || zoomAt !== 0) return
          const t = e.changedTouches[0]
          const dx = t.clientX - s.x
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - s.y)) go(dx < 0 ? 1 : -1)
        }}
      >
        {pdf.status === 'ready' ? (
          <PdfPageView doc={pdf.doc} page={page} zoom={zoom} label={`Задания, страница ${page} из ${pages}`} />
        ) : pdf.status === 'failed' ? (
          <p className="max-w-[420px] px-4 py-8 text-center text-sm text-graphite-600" data-testid="mock-lesson-tasks-failed">
            Задания не получилось показать на странице — откройте их ссылкой «Открыть PDF» выше.
          </p>
        ) : (
          <span className="inline-flex items-center gap-2 py-10 text-sm text-graphite-400"><Loader2 size={16} className="animate-spin" />Готовлю задания…</span>
        )}
      </div>
      {pdf.status === 'ready' && pages > 1 && <span className="text-[13px] text-graphite-500 lg:hidden">листайте пальцем или стрелками · можно увеличить</span>}
    </section>
  )
}
