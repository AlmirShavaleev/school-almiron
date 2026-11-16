import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { useSignedPdf } from '@/hooks/useSignedPdf'
import { PdfPageView } from '@/components/pdf/PdfPageView'
import type { PrivateBucket } from '@/lib/storage'

/**
 * PDF теории страницами прямо во вкладке «Теория».
 *
 * Зачем. У 99 тем курса теория — текстовая страница (`TheoryArticle`), у
 * десятка старых (планиметрия, векторы) есть только PDF. Ученик видел у них
 * серую плитку «скачать» и уходил из урока в чужой просмотрщик; на телефоне
 * это отдельное приложение. Здесь тот же PDF показывается листами подряд,
 * плитка для скачивания остаётся под ним.
 *
 * Отрисовка — общая с условием пробника и панелью решения (`useSignedPdf` +
 * `PdfPageView`, §229): pdf.js грузится лениво, в общий бандл не идёт.
 *
 * Память. В теории 10–20 страниц, а холст страницы во всю ширину телефона с
 * множителем плотности экрана весит несколько мегабайт. Все листы разом
 * роняли бы вкладку (так уже было с двумя плеерами видео, письмо 19.10),
 * поэтому лист рисуется, только пока он рядом с экраном, а дальше остаётся
 * пустая рамка той же высоты — прокрутка не прыгает.
 */

/** Страница A4: место под лист занимается заранее, до отрисовки. */
const PAGE_ASPECT = '1 / 1.414'
/** Насколько заранее начинать рисовать лист и когда его отпускать. */
const NEAR_MARGIN = '1200px 0px'

export function TheoryPdfPages({ bucket, storagePath, onShown }: {
  bucket: PrivateBucket
  storagePath: string
  /** Документ загрузился и показан — для учёта просмотров (§107). */
  onShown?: () => void
}) {
  const pdf = useSignedPdf(bucket, storagePath)
  const shownRef = useRef(false)

  useEffect(() => {
    if (pdf.status !== 'ready' || shownRef.current) return
    shownRef.current = true
    onShown?.()
  }, [pdf.status, onShown])

  if (pdf.status === 'failed') {
    return (
      <p className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Не удалось показать теорию страницами — откройте файл ниже.
      </p>
    )
  }

  if (pdf.status !== 'ready') {
    return (
      <div className="mb-3 flex items-center gap-2 py-4 text-sm text-gray-400" data-testid="theory-pdf-loading">
        <Loader2 size={14} className="animate-spin" />
        Готовлю теорию…
      </div>
    )
  }

  return (
    <div data-testid="theory-pdf-pages" className="mb-3 space-y-2">
      {Array.from({ length: pdf.pages }, (_, i) => (
        <LazyPage key={i + 1} doc={pdf.doc} page={i + 1} total={pdf.pages} />
      ))}
    </div>
  )
}

function LazyPage({ doc, page, total }: { doc: PDFDocumentProxy; page: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // Первые листы — сразу, не дожидаясь наблюдателя: иначе вкладка на миг пустая.
  const [near, setNear] = useState(page <= 2)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Старый браузер или тестовое окружение без наблюдателя — рисуем как есть.
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver(
      entries => { const e = entries[0]; if (e) setNear(e.isIntersecting) },
      { rootMargin: NEAR_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} style={{ aspectRatio: PAGE_ASPECT }} data-testid="theory-pdf-page" data-page={page}>
      {near && (
        <PdfPageView doc={doc} page={page} className="w-full" label={`Теория, страница ${page} из ${total}`} />
      )}
    </div>
  )
}
