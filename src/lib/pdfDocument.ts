import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * §229. Открыть PDF из байтов — для условия варианта у ученика и PDF вместо
 * фото на проверке пробника (`useSignedPdf`). Модуль грузится ТОЛЬКО
 * динамическим импортом: pdf.js (~450 КБ) в общий бандл не идёт (как у
 * `SolutionPdfPages`, чей `SolutionPdfPage` рисует страницы).
 *
 * Байты, а не ссылка: ссылка на условие короткая (5 минут, `sensitive`), а
 * pdf.js с `url` дочитывает файл кусками по ходу листания — через полчаса
 * пробника куски пришли бы уже по протухшей ссылке.
 */
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export async function openPdfDocument(data: ArrayBuffer): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise
}
