/**
 * §206. Главная проверка самописного писателя PDF: собранные байты открывает
 * настоящий `pdfjs-dist` — тот же движок, которым работу читает браузер.
 *
 * Своя проверка структуры («в файле есть строка /Type /Page») здесь ничего не
 * стоила бы: ломаются такие писатели на смещениях `xref`, а их глазами не
 * видно. Файл либо открывается движком, либо нет.
 */
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildJpegPdf, pageSizePt } from '../pdfWriter'

/**
 * Две крошечные картинки разного размера (16×24 и 32×16), закодированные
 * base64. Настоящий JPEG нужен по-честному: `DCTDecode` движок разбирает сам,
 * и подделка байтов провалилась бы именно там, где важно.
 */
const JPEG_16x24 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDZ/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1rn387/j/lY9j4P7vL8+S//pXN+Af8jz/04/Yv+2u/f/3zjGz360f8jz/04/Yv+2u/f/3zjGz360UUR961+u4Vf3XPyacluXyvv/TP/9k='
const JPEG_32x16 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDU/wCR+/6cPsP/AG137/8AvnGNnv1o/wCR+/6cPsP/AG137/8AvnGNnv1o/wCR+/6cPsP/AG137/8AvnGNnv1o/wCR+/6cPsP/AG137/8AvnGNnv1r1fh/u8vz5b/nf8DDfzv+P+Vg/wCR+/6cPsP/AG137/8AvnGNnv1o/wCR+/6cPsP/AG137/8AvnGNnv1o/wCR+/6cPsP/AG137/8AvnGNnv1o+H+7y/Plv+d/wDfzv+P+Vj//2Q=='

function jpegBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * pdfjs в vitest: берём legacy-сборку (она рассчитана на Node) и указываем
 * воркер файловым URL — в jsdom `import.meta.url` указывает на http, а
 * загрузчик модулей Node такую схему не принимает.
 */
async function openWithPdfjs(bytes: Uint8Array) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href
  // Копия: getDocument забирает буфер себе, а байты нужны и тесту.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
  return { pdfjs, doc }
}

describe('buildJpegPdf', () => {
  it('собирает файл, который открывает настоящий pdfjs: страницы, размеры, картинка на месте', async () => {
    const bytes = buildJpegPdf([
      { jpeg: jpegBytes(JPEG_16x24), widthPx: 16, heightPx: 24 },
      { jpeg: jpegBytes(JPEG_32x16), widthPx: 32, heightPx: 16 },
    ])

    const { pdfjs, doc } = await openWithPdfjs(bytes)
    expect(doc.numPages).toBe(2)

    const first = await doc.getPage(1)
    const firstView = first.getViewport({ scale: 1 })
    // 16 × 24 пикселя по 96 dpi — 12 × 18 пунктов, лист книжный.
    expect(firstView.width).toBeCloseTo(12, 5)
    expect(firstView.height).toBeCloseTo(18, 5)

    const second = await doc.getPage(2)
    const secondView = second.getViewport({ scale: 1 })
    // Вторая — альбомная, по пропорции своей картинки, а не подогнана к первой.
    expect(secondView.width).toBeCloseTo(24, 5)
    expect(secondView.height).toBeCloseTo(12, 5)

    // Картинка на странице есть: движок дошёл до операции рисования XObject.
    const ops = await first.getOperatorList()
    expect(ops.fnArray).toContain(pdfjs.OPS.paintImageXObject)
  }, 60000)

  it('держит верные смещения xref при длинной картинке и многих страницах', async () => {
    // Смещения ломаются на длине потоков: одинаковые короткие страницы могут
    // «сойтись» случайно, поэтому страниц много и они разные.
    const pages = Array.from({ length: 7 }, (_value, index) => (
      index % 2 === 0
        ? { jpeg: jpegBytes(JPEG_16x24), widthPx: 16, heightPx: 24 }
        : { jpeg: jpegBytes(JPEG_32x16), widthPx: 32, heightPx: 16 }
    ))
    const bytes = buildJpegPdf(pages)

    const { doc } = await openWithPdfjs(bytes)
    expect(doc.numPages).toBe(7)
    // Последняя страница читается только по верному смещению своего объекта.
    const last = await doc.getPage(7)
    expect(last.getViewport({ scale: 1 }).width).toBeCloseTo(12, 5)
  }, 60000)

  it('уважает явный размер листа в пунктах, когда растр крупнее листа', async () => {
    const bytes = buildJpegPdf([
      { jpeg: jpegBytes(JPEG_16x24), widthPx: 16, heightPx: 24, widthPt: 595.28, heightPt: 841.89 },
    ])
    const { doc } = await openWithPdfjs(bytes)
    const page = await doc.getPage(1)
    const view = page.getViewport({ scale: 1 })
    expect(view.width).toBeCloseTo(595.28, 1)
    expect(view.height).toBeCloseTo(841.89, 1)
  }, 60000)

  it('без страниц и с пустой картинкой — ошибка, а не огрызок файла', () => {
    expect(() => buildJpegPdf([])).toThrow()
    expect(() => buildJpegPdf([{ jpeg: new Uint8Array(0), widthPx: 10, heightPx: 10 }])).toThrow()
    expect(() => buildJpegPdf([{ jpeg: jpegBytes(JPEG_16x24), widthPx: 0, heightPx: 10 }])).toThrow()
  })

  it('размер листа по умолчанию — пиксели по 96 dpi', () => {
    expect(pageSizePt({ jpeg: new Uint8Array(1), widthPx: 96, heightPx: 192 }))
      .toEqual({ widthPt: 72, heightPt: 144 })
  })
})
