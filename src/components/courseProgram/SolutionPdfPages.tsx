import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Loader2 } from 'lucide-react'

/**
 * Свой лёгкий просмотрщик PDF для панели «Решение задания».
 *
 * Зачем свой. Раньше решение показывал встроенный просмотрщик браузера
 * (`<object type="application/pdf">`): чёрная панель инструментов, лента
 * миниатюр и своя кнопка масштаба съедали половину и без того узкой панели, и
 * выглядело это чужеродно рядом с работой ученика. Здесь только страницы:
 * подряд сверху вниз, во всю ширину панели, одна вертикальная прокрутка —
 * прокрутка самой панели, своей у просмотрщика нет.
 *
 * Это НЕ копия `SubmissionReviewer`: там аннотатор с рамками, слоями, зумом и
 * координатами — здесь читалка на сотню строк. Общий у них только приём
 * отрисовки страницы в canvas (pdfjs + devicePixelRatio); выносить общую часть
 * из аннотатора я не стал — это чужая зона, и ради читалки трогать рабочий
 * разбор работы неразумно.
 *
 * Воркер назначается здесь же: аннотатор грузится лениво, и полагаться на то,
 * что он уже выставил `workerSrc`, нельзя — панель решения открывается раньше.
 * Присваивание идемпотентно, значение то же самое.
 *
 * Модуль грузится ЛЕНИВО (см. `SolutionReferencePanel`): pdfjs весит ~450 КБ, и
 * тянуть его в общий бандл ради панели, которую открывает только персонал и
 * только на разборе работы, незачем. Первым это поймал тест соседнего экрана —
 * в jsdom нет `DOMMatrix`, и обычный импорт ронял его целиком.
 */
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

/**
 * Пауза перед перерисовкой при изменении ширины. Ползунок ширины панели (§138)
 * шлёт события пачками; без паузы каждая страница пересобиралась бы десятки
 * раз за перетаскивание.
 */
const RESIZE_DEBOUNCE_MS = 120

function SolutionPdfPages({ url, name }: { url: string; name: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState(0)
  const [width, setWidth] = useState(0)
  const [failed, setFailed] = useState(false)

  // Документ. Подписанная ссылка живёт час, панель открыта столько, сколько
  // идёт проверка: если ссылка протухнет, документ уже загружен в память и
  // страницы продолжают рисоваться.
  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setPdf(null)
    setPages(0)

    const task = pdfjs.getDocument({ url })
    task.promise
      .then(doc => {
        // Документ не освобождаем вручную: в типах pdfjs у него нет `destroy`,
        // а память отдаёт `task.destroy()` в уборке эффекта ниже.
        if (cancelled) return
        setPdf(doc)
        setPages(doc.numPages)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => {
      cancelled = true
      void task.destroy?.()
    }
  }, [url])

  // Ширина панели. ResizeObserver, а не событие окна: панель меняет ширину и
  // от ползунка, и от кнопки «Решение», а окно при этом не трогается.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return

    let timer: number | undefined
    const apply = (next: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setWidth(Math.round(next)), RESIZE_DEBOUNCE_MS)
    }

    apply(box.clientWidth)
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width ?? box.clientWidth
      if (next > 0) apply(next)
    })
    observer.observe(box)

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  if (failed) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Не удалось показать «{name}» страницами — откройте файл отдельно ссылкой ниже.
      </p>
    )
  }

  return (
    <div ref={boxRef} data-testid="solution-pdf-pages" className="space-y-2">
      {!pdf && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" />
          Готовлю решение…
        </div>
      )}

      {pdf && width > 0 && Array.from({ length: pages }, (_, i) => (
        <SolutionPdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={width} />
      ))}
    </div>
  )
}

/**
 * Одна страница. Рисуется в canvas под текущую ширину панели и под плотность
 * экрана: без множителя `devicePixelRatio` страница мылится на ретине, а после
 * перетаскивания ползунка — на любом экране, потому что растянутый холст
 * остаётся в старом разрешении.
 */
function SolutionPdfPage({
  pdf, pageNumber, width,
}: {
  pdf: pdfjs.PDFDocumentProxy
  pageNumber: number
  width: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<pdfjs.RenderTask | null>(null)
  const [ratio, setRatio] = useState<number | null>(null)

  useEffect(() => {
    if (!width) return
    let cancelled = false

    pdf.getPage(pageNumber).then(page => {
      if (cancelled || !canvasRef.current) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.max(0.1, width / base.width)
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const renderViewport = page.getViewport({ scale: scale * dpr })

      const canvas = canvasRef.current
      canvas.width = renderViewport.width
      canvas.height = renderViewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setRatio(viewport.width / viewport.height)

      // Предыдущая отрисовка могла не закончиться: при быстром перетаскивании
      // ползунка их набегает несколько, и без отмены они дерутся за холст.
      taskRef.current?.cancel()
      const context = canvas.getContext('2d')
      if (!context) return
      const task = page.render({ canvas, canvasContext: context, viewport: renderViewport })
      taskRef.current = task
      task.promise.catch((error: any) => {
        if (error?.name !== 'RenderingCancelledException') return
      })
    }).catch(() => undefined)

    return () => {
      cancelled = true
      taskRef.current?.cancel()
    }
  }, [pdf, pageNumber, width])

  return (
    <div
      data-testid={`solution-pdf-page-${pageNumber}`}
      className="overflow-hidden rounded-lg border border-gray-200 bg-white"
      // Место под страницу занимается заранее: иначе при перерисовке панель
      // схлопывается и прокрутка прыгает под руками.
      style={{ aspectRatio: ratio ?? 1 / 1.414 }}
    >
      <canvas ref={canvasRef} className="block max-w-none" />
    </div>
  )
}

export default SolutionPdfPages
