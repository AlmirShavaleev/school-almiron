/**
 * §206. Сборка файла целиком: сколько страниц и какого размера получилось.
 *
 * Рисование здесь заглушено (в vitest canvas всё равно не рисует), а вот
 * СКЛЕЙКА настоящая: страницы работы и листы разбора складываются в реальный
 * PDF и открываются настоящим `pdfjs`. Именно так проверяется, что порядок
 * страниц при нескольких файлах сохраняется и что длинный разбор добавляет
 * лист, а не обрезается.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildAttemptPdf, commentsFromRegions } from '../attemptPdfRender'
import type { AttemptExportSnapshot } from '../attemptPdfSource'
import type { AttemptPdfReport } from '../attemptPdfReport'

/** Крошечный настоящий JPEG 16×24 — им «рисуется» каждая страница. */
const JPEG_16x24 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDZ/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1o/wCR5/6cfsX/AG137/8AvnGNnv1rn387/j/lY9j4P7vL8+S//pXN+Af8jz/04/Yv+2u/f/3zjGz360f8jz/04/Yv+2u/f/3zjGz360UUR961+u4Vf3XPyacluXyvv/TP/9k='

function jpegBytes(): Uint8Array {
  const binary = atob(JPEG_16x24)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Холст, который умеет всё, что зовёт отрисовка, и отдаёт готовый JPEG. */
function stubCanvas() {
  const ctx: any = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'measureText') return () => ({ width: 40 })
      if (key === 'canvas') return undefined
      return () => undefined
    },
    set: () => true,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => ctx })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value: (done: (blob: Blob) => void) => done(new Blob([jpegBytes() as BlobPart], { type: 'image/jpeg' })),
  })
}

function fakePdfDocument() {
  return {
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 595.28 * scale, height: 841.89 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  } as any
}

const REPORT: AttemptPdfReport = {
  studentName: 'Иванов Иван',
  homeworkTitle: 'ДЗ №3',
  topicTitle: 'Тема',
  submittedAt: '2026-09-18T12:00:00.000Z',
  reviewedAt: '2026-09-19T07:00:00.000Z',
  decision: 'accepted',
  score: 4,
  scoreMax: 5,
  comment: null,
  tasks: [],
}

function snapshot(): AttemptExportSnapshot {
  const pdf = fakePdfDocument()
  return {
    // §209.1. Здесь проверяется сборка уже готового слепка; неготовый до
    // сборщика не доходит вовсе — его отсекает кнопка.
    ready: true,
    surfaces: [
      { globalPage: 1, kind: 'image', url: 'signed://a.jpg', page: 1, ratio: 0.75, quarter: 0, pdf: null },
      { globalPage: 2, kind: 'pdf', url: 'signed://b.pdf', page: 1, ratio: 0.7, quarter: 0, pdf },
      { globalPage: 3, kind: 'pdf', url: 'signed://b.pdf', page: 2, ratio: 0.7, quarter: 0, pdf },
    ],
    regions: [
      { number: 1, globalPage: 1, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, categoryLabel: 'Вычислительная ошибка', color: '#dc2626', text: 'Знак' },
      { number: 2, globalPage: 3, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, categoryLabel: 'Оформление', color: '#ea580c', text: 'Единицы' },
    ],
  }
}

async function openWithPdfjs(bytes: Uint8Array) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise
}

describe('buildAttemptPdf', () => {
  beforeEach(() => {
    stubCanvas()
    // Картинка страницы качается байтами: так холст не «пачкается» чужим
    // источником и toBlob на нём работает.
    vi.stubGlobal('fetch', async () => ({ ok: true, blob: async () => new Blob([jpegBytes() as BlobPart], { type: 'image/jpeg' }) }))
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1200, height: 1600, close: () => {} }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('страницы работы идут по порядку, последней — разбор; файл открывает настоящий pdfjs', async () => {
    const progress: [number, number][] = []
    const blob = await buildAttemptPdf({
      snapshot: snapshot(),
      report: REPORT,
      onProgress: (done, total) => progress.push([done, total]),
    })
    const doc = await openWithPdfjs(new Uint8Array(await blob.arrayBuffer()))

    expect(blob.type).toBe('application/pdf')
    expect(doc.numPages).toBe(4)

    // Первая — фотография: лист по её пропорции (1200×1600 → 3:4), не A4.
    const first = (await doc.getPage(1)).getViewport({ scale: 1 })
    expect(first.width / first.height).toBeCloseTo(0.75, 3)
    // Вторая и третья — листы исходного PDF, размер сохранён.
    const second = (await doc.getPage(2)).getViewport({ scale: 1 })
    expect(second.width).toBeCloseTo(595.28, 1)
    expect(second.height).toBeCloseTo(841.89, 1)
    // Последняя — разбор на A4.
    const last = (await doc.getPage(4)).getViewport({ scale: 1 })
    expect(last.width).toBeCloseTo(595.5, 1)
    expect(last.height).toBeCloseTo(842.25, 1)

    // «Готовлю N из M» считает все страницы, включая разбор.
    expect(progress[0]).toEqual([0, 4])
    expect(progress[progress.length - 1]).toEqual([4, 4])
  }, 60000)

  it('длинный разбор добавляет лист, а не обрезается', async () => {
    const many = snapshot()
    many.regions = Array.from({ length: 40 }, (_v, index) => ({
      number: index + 1,
      globalPage: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
      categoryLabel: 'Комментарий',
      color: '#2563eb',
      text: `Замечание ${index + 1}`,
    }))
    const blob = await buildAttemptPdf({ snapshot: many, report: REPORT })
    const doc = await openWithPdfjs(new Uint8Array(await blob.arrayBuffer()))
    // Три страницы работы плюс минимум два листа разбора.
    expect(doc.numPages).toBeGreaterThanOrEqual(5)
  }, 60000)

  it('страница, которую не удалось скачать, останавливает сборку целиком', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, blob: async () => new Blob([]) }))
    await expect(buildAttemptPdf({ snapshot: snapshot(), report: REPORT })).rejects.toThrow()
  }, 60000)

  it('замечания для разбора берутся из тех же рамок', () => {
    expect(commentsFromRegions(snapshot().regions).map(c => [c.number, c.globalPage, c.text])).toEqual([
      [1, 1, 'Знак'],
      [2, 3, 'Единицы'],
    ])
  })
})
