import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getSignedFileUrl, SHORT_SIGNED_URL_TTL_S, SIGNED_URL_TTL_S, type PrivateBucket } from '@/lib/storage'

/**
 * §229. PDF из приватного бакета — документ pdf.js и число страниц.
 *
 * Условие варианта у ученика (листать и увеличивать) и PDF вместо фото на
 * проверке пробника (страницы как листы). Отрисовка — та же, что у панели
 * решения (`SolutionPdfPages`, её `SolutionPdfPage`), модуль грузится
 * динамически: pdf.js весит ~450 КБ и в общий бандл не идёт.
 *
 * Ссылка подписывается под токеном смотрящего — хранилище выдаёт только то,
 * что пускает политика (`mock_exam_file_readable`: условие — с начала окна и
 * только своего варианта). Байты читаются один раз и держатся в памяти
 * страницы (кэш по бакету и пути): протухшая ссылка не мешает листать.
 * Любой сбой (нет права, сеть, битый файл, окружение без canvas) — `failed`,
 * экран показывает ссылку «Открыть PDF» вместо страниц.
 */

export type SignedPdfState =
  | { status: 'idle' | 'loading' | 'failed'; doc: null; pages: 0 }
  | { status: 'ready'; doc: PDFDocumentProxy; pages: number }

const cache = new Map<string, Promise<PDFDocumentProxy>>()

async function load(bucket: PrivateBucket, path: string, sensitive: boolean): Promise<PDFDocumentProxy> {
  const mod = await import('@/lib/pdfDocument')
  const url = await getSignedFileUrl(bucket, path, sensitive ? SHORT_SIGNED_URL_TTL_S : SIGNED_URL_TTL_S)
  if (!url) throw new Error('Нет доступа к файлу')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return mod.openPdfDocument(await res.arrayBuffer())
}

export function loadSignedPdf(bucket: PrivateBucket, path: string, sensitive = false): Promise<PDFDocumentProxy> {
  const k = `${bucket}/${path}`
  let p = cache.get(k)
  if (!p) {
    p = load(bucket, path, sensitive)
    cache.set(k, p)
    // Неудача не кэшируется: второй заход (сеть вернулась) пробует снова.
    p.catch(() => { if (cache.get(k) === p) cache.delete(k) })
  }
  return p
}

export function useSignedPdf(bucket: PrivateBucket, path: string | null | undefined, opts: { sensitive?: boolean } = {}): SignedPdfState {
  const sensitive = !!opts.sensitive
  const [state, setState] = useState<{ path: string | null; s: SignedPdfState }>({ path: null, s: { status: 'idle', doc: null, pages: 0 } })

  useEffect(() => {
    if (!path) return
    let cancelled = false
    loadSignedPdf(bucket, path, sensitive).then(
      doc => { if (!cancelled) setState({ path, s: { status: 'ready', doc, pages: doc.numPages } }) },
      () => { if (!cancelled) setState({ path, s: { status: 'failed', doc: null, pages: 0 } }) },
    )
    return () => { cancelled = true }
  }, [bucket, path, sensitive])

  if (!path) return { status: 'idle', doc: null, pages: 0 }
  if (state.path !== path) return { status: 'loading', doc: null, pages: 0 }
  return state.s
}
