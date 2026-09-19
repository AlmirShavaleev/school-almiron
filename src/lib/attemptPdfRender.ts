/**
 * §206. Отрисовка страниц скачиваемого PDF на canvas.
 *
 * Страницы работы кладутся в файл картинками, а не текстом, по двум причинам,
 * и обе стоит помнить:
 *
 *  1. Работа и так фотография тетради — выделяемого текста там нет.
 *  2. Кириллица. Свой текст в PDF потребовал бы встроенного шрифта с
 *     кириллицей: отдельная возня и лишние сотни килобайт в бандле. Текст,
 *     нарисованный на canvas, берёт системный шрифт и читается всегда.
 *
 * Модуль браузерный: он и только он трогает canvas, `fetch` и `Blob`. Всё,
 * что можно проверить тестом, вынесено в `attemptPdfReport` (раскладка) и
 * `pdfWriter` (байты файла).
 */

import { buildJpegPdf, type PdfJpegPage } from './pdfWriter'
import {
  REPORT_PAGE_HEIGHT,
  REPORT_PAGE_WIDTH,
  buildReportPages,
  type AttemptPdfComment,
  type AttemptPdfReport,
  type ReportDraw,
  type TextMeasure,
} from './attemptPdfReport'
import type { AttemptExportRegion, AttemptExportSnapshot, AttemptExportSurface } from './attemptPdfSource'

/**
 * Длинная сторона страницы работы в пикселях. Больше не нужно — это
 * фотография тетради, — а память браузера не бесконечная: одиннадцать
 * страниц по 2000 px это уже около 130 МБ сырых пикселей, и они держатся
 * по одной, а не все сразу.
 */
const MAX_PAGE_SIDE_PX = 2000
/** Длинная сторона листа в пунктах: A4. Крупнее делать лист незачем. */
const MAX_PAGE_SIDE_PT = 842
/** Разбор рисуем плотнее листа — 2× A4, иначе мелкий текст в файле мылится. */
const REPORT_SCALE = 2
const JPEG_QUALITY = 0.82

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не дал холст для сборки файла')
  return ctx
}

/** JPEG без альфа-канала: прозрачный холст стал бы чёрным листом. */
function fillWhite(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(done => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob(done, 'image/jpeg', JPEG_QUALITY)
    else done(null)
  })
  if (blob) return new Uint8Array(await blob.arrayBuffer())

  // Запасной путь для окружений без toBlob: тот же JPEG, только через data-URL.
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const base64 = url.slice(url.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Картинка работы. Качаем байтами и рисуем из blob, а не вешаем подписанную
 * ссылку прямо на `<img>`: холст с картинкой из другого источника «пачкается»
 * и `toBlob` на нём падает. Через blob источник свой, и файл собирается
 * всегда.
 */
async function loadImage(url: string): Promise<{ image: CanvasImageSource; width: number; height: number; release: () => void }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Не удалось скачать страницу работы')
  const blob = await response.blob()

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((done, fail) => {
      const element = new Image()
      element.onload = () => done(element)
      element.onerror = () => fail(new Error('Страница работы не открылась'))
      element.src = objectUrl
    })
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

/** Лист под картинку: пропорция её собственная, длинная сторона — не больше A4. */
function pageSizeFor(widthPx: number, heightPx: number): { widthPt: number; heightPt: number } {
  const byDpi = Math.max(widthPx, heightPx) * 0.75
  const longPt = Math.min(byDpi, MAX_PAGE_SIDE_PT)
  const scale = longPt / Math.max(widthPx, heightPx)
  return { widthPt: widthPx * scale, heightPt: heightPx * scale }
}

/** Рамки с номерами — тем же цветом и в тех же долях страницы, что на экране. */
function drawRegions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: readonly AttemptExportRegion[],
) {
  const stroke = Math.max(2, width * 0.004)
  const radius = Math.max(10, width * 0.018)
  for (const region of regions) {
    const x = region.rect.x * width
    const y = region.rect.y * height
    const w = region.rect.w * width
    const h = region.rect.h * height

    ctx.save()
    ctx.fillStyle = region.color
    ctx.globalAlpha = 0.1
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
    ctx.lineWidth = stroke
    ctx.strokeStyle = region.color
    ctx.strokeRect(x, y, w, h)

    // Кружок с номером прижимаем внутрь листа: у рамки на самом краю он иначе
    // уехал бы за обрез.
    const cx = Math.min(Math.max(x, radius), width - radius)
    const cy = Math.min(Math.max(y, radius), height - radius)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = region.color
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${Math.round(radius * 1.25)}px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(region.number), cx, cy + radius * 0.06)
    ctx.restore()
  }
}

async function renderWorkPage(
  surface: AttemptExportSurface,
  regions: readonly AttemptExportRegion[],
): Promise<PdfJpegPage> {
  if (surface.kind === 'pdf') {
    const pdf = surface.pdf
    if (!pdf) throw new Error(`Страница ${surface.globalPage} не открыта движком PDF`)
    const page = await pdf.getPage(surface.page)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.max(1, Math.min(MAX_PAGE_SIDE_PX / Math.max(base.width, base.height), 3))
    const viewport = page.getViewport({ scale })
    const canvas = makeCanvas(viewport.width, viewport.height)
    const ctx = context2d(canvas)
    fillWhite(ctx, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    drawRegions(ctx, canvas.width, canvas.height, regions)
    return {
      jpeg: await canvasToJpeg(canvas),
      widthPx: canvas.width,
      heightPx: canvas.height,
      // Лист остаётся ровно таким, каким он был в исходном PDF: A4 — значит A4.
      widthPt: base.width,
      heightPt: base.height,
    }
  }

  const { image, width, height, release } = await loadImage(surface.url)
  try {
    const scale = Math.min(1, MAX_PAGE_SIDE_PX / Math.max(width, height))
    const canvas = makeCanvas(width * scale, height * scale)
    const ctx = context2d(canvas)
    fillWhite(ctx, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    drawRegions(ctx, canvas.width, canvas.height, regions)
    const { widthPt, heightPt } = pageSizeFor(width, height)
    return { jpeg: await canvasToJpeg(canvas), widthPx: canvas.width, heightPx: canvas.height, widthPt, heightPt }
  } finally {
    release()
  }
}

function drawReport(ctx: CanvasRenderingContext2D, items: readonly ReportDraw[]) {
  for (const item of items) {
    if (item.kind === 'text') {
      ctx.font = `${item.bold ? 'bold ' : ''}${item.size}px ${FONT_STACK}`
      ctx.fillStyle = item.color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(item.text, item.x, item.y)
    } else if (item.kind === 'rect') {
      const radius = item.radius ?? 0
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function' && radius > 0) ctx.roundRect(item.x, item.y, item.w, item.h, radius)
      else ctx.rect(item.x, item.y, item.w, item.h)
      if (item.fill) {
        ctx.fillStyle = item.fill
        ctx.fill()
      }
      if (item.stroke) {
        ctx.lineWidth = 1
        ctx.strokeStyle = item.stroke
        ctx.stroke()
      }
    } else if (item.kind === 'circle') {
      ctx.beginPath()
      ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2)
      ctx.fillStyle = item.fill
      ctx.fill()
    } else {
      ctx.fillStyle = item.color
      ctx.fillRect(item.x, item.y, item.w, 1)
    }
  }
}

function measureWith(ctx: CanvasRenderingContext2D): TextMeasure {
  return (text, size, bold) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`
    return ctx.measureText(text).width
  }
}

/** Замечания для последней страницы — из тех же рамок, что на страницах. */
export function commentsFromRegions(regions: readonly AttemptExportRegion[]): AttemptPdfComment[] {
  return regions.map(region => ({
    number: region.number,
    globalPage: region.globalPage,
    categoryLabel: region.categoryLabel,
    color: region.color,
    text: region.text,
    taskNo: region.taskNo ?? null,
  }))
}

export interface BuildAttemptPdfOptions {
  snapshot: AttemptExportSnapshot
  report: AttemptPdfReport
  /** «Готовлю 3 из 11»: одиннадцать страниц в 2× рисуются не мгновенно. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Собирает весь файл целиком. Падение на любой странице — исключение наружу:
 * скачанный огрызок хуже честного «не получилось».
 */
export async function buildAttemptPdf({ snapshot, report, onProgress }: BuildAttemptPdfOptions): Promise<Blob> {
  const measureCanvas = makeCanvas(10, 10)
  const measure = measureWith(context2d(measureCanvas))
  const reportPages = buildReportPages(report, commentsFromRegions(snapshot.regions), measure)

  const total = snapshot.surfaces.length + reportPages.length
  if (total === 0) throw new Error('В этой работе нечего скачивать')
  let done = 0
  const tick = () => {
    done += 1
    onProgress?.(done, total)
  }
  onProgress?.(0, total)

  const pages: PdfJpegPage[] = []
  for (const surface of snapshot.surfaces) {
    const regions = snapshot.regions.filter(region => region.globalPage === surface.globalPage)
    pages.push(await renderWorkPage(surface, regions))
    tick()
  }

  for (const items of reportPages) {
    const canvas = makeCanvas(REPORT_PAGE_WIDTH * REPORT_SCALE, REPORT_PAGE_HEIGHT * REPORT_SCALE)
    const ctx = context2d(canvas)
    fillWhite(ctx, canvas.width, canvas.height)
    ctx.scale(REPORT_SCALE, REPORT_SCALE)
    drawReport(ctx, items)
    pages.push({
      jpeg: await canvasToJpeg(canvas),
      widthPx: canvas.width,
      heightPx: canvas.height,
      // Растр вдвое плотнее, а лист обязан остаться A4.
      widthPt: REPORT_PAGE_WIDTH * 0.75,
      heightPt: REPORT_PAGE_HEIGHT * 0.75,
    })
    tick()
  }

  return new Blob([buildJpegPdf(pages) as BlobPart], { type: 'application/pdf' })
}

/** Скачивание: ссылка на время, клик, и сразу освободить память. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Клик уже начал сохранение; ссылку держим один тик, чтобы не отозвать её
  // у браузера прямо из-под скачивания.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
