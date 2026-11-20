import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDensityFor } from '../../supabase/functions/check-homework-ai/findings.ts'

export * from '../../supabase/functions/check-homework-ai/pdf.ts'

const pdfjsDirectory = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
const pdfjsDataPath = folder => join(pdfjsDirectory, folder) + sep

// The Node-only preview uses the same PDF.js package as the browser viewer.
export async function renderPdfPages(bytes, limit, budgetMs, jpegQuality = 80) {
  const loading = getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false,
    wasmUrl: pdfjsDataPath('wasm'), standardFontDataUrl: pdfjsDataPath('standard_fonts'),
    cMapUrl: pdfjsDataPath('cmaps'), useWorkerFetch: false,
  })
  try {
    const document = await loading.promise
    const total = document.numPages
    const { dpi, maxWidth } = renderDensityFor(total)
    const images = []
    const startedAt = Date.now()
    for (let pageNumber = 1; pageNumber <= Math.min(limit, total); pageNumber++) {
      if (images.length && Date.now() - startedAt > budgetMs) break
      const page = await document.getPage(pageNumber)
      const original = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(dpi / 72, maxWidth / original.width) })
      const surface = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport }).promise
        images.push({ page: pageNumber, bytes: await surface.canvas.encode('jpeg', jpegQuality) })
      } finally {
        document.canvasFactory.destroy(surface)
      }
    }
    return { images, total, spentMs: Date.now() - startedAt }
  } finally {
    await loading.destroy()
  }
}
