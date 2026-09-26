import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'

/**
 * §229. Одна страница PDF во всю ширину своей коробки × масштаб.
 *
 * Сама отрисовка — `SolutionPdfPage` панели решения (§138/§226): canvas под
 * ширину и плотность экрана, место под страницу занято заранее. Здесь только
 * ширина коробки (ResizeObserver) и масштаб; модуль с pdf.js — лениво.
 */
const SolutionPdfPage = lazy(() => import('@/components/courseProgram/SolutionPdfPages').then(m => ({ default: m.SolutionPdfPage })))

export function PdfPageView({ doc, page, zoom = 1, className, label }: {
  doc: PDFDocumentProxy
  page: number
  /** 1 — по ширине коробки; больше — шире коробки, коробка прокручивается. */
  zoom?: number
  className?: string
  label?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const apply = () => { if (el.clientWidth > 0) setWidth(el.clientWidth) }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const w = Math.round(width * zoom)
  return (
    <div ref={box} className={className} role="img" aria-label={label ?? `Страница ${page}`} data-testid="pdf-page-view" data-page={page}>
      {w > 0 && (
        <PageBoundary>
          <Suspense fallback={<PageLoading />}>
            <div style={{ width: w }}>
              <SolutionPdfPage pdf={doc} pageNumber={page} width={w} />
            </div>
          </Suspense>
        </PageBoundary>
      )}
    </div>
  )
}

function PageLoading() {
  return <div className="flex h-40 items-center justify-center text-graphite-400"><Loader2 size={18} className="animate-spin" aria-label="Готовлю страницу" /></div>
}

/** Модуль страницы не загрузился (сеть, старый браузер) — тихая заглушка, а не упавший экран. */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <p className="rounded-lg bg-graphite-50 px-3 py-6 text-center text-sm text-graphite-500">Страницу не удалось показать — откройте файл ссылкой.</p>
    return this.props.children
  }
}
