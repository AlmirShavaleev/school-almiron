/**
 * §206. Сборка PDF из готовых JPEG-страниц — руками, без библиотеки.
 *
 * Почему без `jspdf`/`pdf-lib`: в файл нужно положить ровно то, что уже
 * нарисовано на canvas (фото работы + рамки + разбор), а это один XObject на
 * страницу. Вся механика — заголовок, дерево страниц, поток содержимого и
 * таблица `xref` — умещается в этот модуль, и он проверяется настоящим
 * `pdfjs` в тесте. Библиотека ради этого стоила бы сотен килобайт бандла.
 *
 * Слабое место такого писателя ровно одно: смещения в `xref`. Ошибка в них
 * даёт файл, который откроется у одного зрителя и не откроется у другого,
 * поэтому смещения считаются по фактически записанным байтам (`push` ведёт
 * счётчик), а не по предполагаемой длине строк, и тест открывает результат
 * настоящим движком.
 *
 * Модуль чистый: ни DOM, ни сети, ни `Blob`.
 */

/** Точек на дюйм, по которым пиксель картинки превращается в пункт страницы. */
export const CSS_DPI = 96
/** Пунктов в дюйме — по определению PDF. */
export const PDF_DPI = 72

export interface PdfJpegPage {
  /** Байты JPEG, как их отдал `canvas.toBlob('image/jpeg')`. */
  jpeg: Uint8Array
  widthPx: number
  heightPx: number
  /**
   * Размер страницы в пунктах, если он известен точнее, чем «пиксели по 96
   * dpi». Нужен там, где растр намеренно крупнее листа: разбор рисуется на
   * канве вдвое плотнее A4, но страницей обязан остаться A4. По умолчанию —
   * пиксели по 96 dpi, то есть пропорция страницы всегда равна пропорции
   * картинки: фотография тетради боком даёт альбомный лист, а не белые поля.
   */
  widthPt?: number
  heightPt?: number
}

/** Размер страницы в пунктах — то, что окажется в `/MediaBox`. */
export function pageSizePt(page: PdfJpegPage): { widthPt: number; heightPt: number } {
  const widthPt = page.widthPt ?? (page.widthPx * PDF_DPI) / CSS_DPI
  const heightPt = page.heightPt ?? (page.heightPx * PDF_DPI) / CSS_DPI
  return { widthPt, heightPt }
}

/** Число в синтаксисе PDF: без экспоненты и без хвостовых нулей. */
function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error('PDF: нечисловой размер страницы')
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    // Синтаксис PDF, который мы пишем, целиком ASCII; всё остальное — ошибка
    // вызова, а не повод молча испортить файл.
    if (code > 0xff) throw new Error('PDF: в служебной строке не-ASCII символ')
    out[i] = code
  }
  return out
}

/**
 * Собирает PDF, где каждая страница — одна JPEG-картинка во весь лист.
 *
 * Возвращает готовые байты. Пустой список страниц — ошибка: файл без страниц
 * не откроется ни одним зрителем, и отдавать такой на скачивание хуже, чем
 * сказать «не получилось».
 */
export function buildJpegPdf(pages: readonly PdfJpegPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('PDF: нет ни одной страницы')

  const chunks: Uint8Array[] = []
  let offset = 0
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? ascii(part) : part
    chunks.push(bytes)
    offset += bytes.length
  }

  /** Смещение объекта N лежит в offsets[N]; нулевой элемент — свободный. */
  const offsets: number[] = [0]
  const beginObject = (id: number) => {
    offsets[id] = offset
    push(`${id} 0 obj\n`)
  }
  const endObject = () => push('endobj\n')

  const catalogId = 1
  const pagesId = 2
  /** На страницу — три объекта: сам лист, поток содержимого и картинка. */
  const pageId = (index: number) => 3 + index * 3
  const contentId = (index: number) => 4 + index * 3
  const imageId = (index: number) => 5 + index * 3
  const totalObjects = 2 + pages.length * 3

  // Вторая строка — комментарий с байтами >127: по нему пересылки и архиваторы
  // понимают, что файл двоичный и переводы строк портить нельзя.
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  beginObject(catalogId)
  push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`)
  endObject()

  beginObject(pagesId)
  const kids = pages.map((_page, index) => `${pageId(index)} 0 R`).join(' ')
  push(`<< /Type /Pages /Count ${pages.length} /Kids [ ${kids} ] >>\n`)
  endObject()

  pages.forEach((page, index) => {
    if (page.widthPx <= 0 || page.heightPx <= 0) throw new Error('PDF: страница нулевого размера')
    if (page.jpeg.length === 0) throw new Error('PDF: пустая картинка страницы')
    const { widthPt, heightPt } = pageSizePt(page)

    beginObject(pageId(index))
    push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [ 0 0 ${num(widthPt)} ${num(heightPt)} ]`
      + ` /Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >>`
      + ` /Contents ${contentId(index)} 0 R >>\n`,
    )
    endObject()

    // Картинка растягивается на весь лист: cm задаёт матрицу «ширина, высота».
    const content = `q\n${num(widthPt)} 0 0 ${num(heightPt)} 0 0 cm\n/Im0 Do\nQ\n`
    beginObject(contentId(index))
    push(`<< /Length ${content.length} >>\nstream\n`)
    push(content)
    push('endstream\n')
    endObject()

    beginObject(imageId(index))
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx}`
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'
      + ` /Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push('\nendstream\n')
    endObject()
  })

  const xrefOffset = offset
  push(`xref\n0 ${totalObjects + 1}\n`)
  // Ровно 20 байт на запись — иначе зрители читают таблицу со сдвигом.
  push('0000000000 65535 f \n')
  for (let id = 1; id <= totalObjects; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size ${totalObjects + 1} /Root ${catalogId} 0 R >>\n`)
  push(`startxref\n${xrefOffset}\n%%EOF\n`)

  const total = chunks.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of chunks) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}
