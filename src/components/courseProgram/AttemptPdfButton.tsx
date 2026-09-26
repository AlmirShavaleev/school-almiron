/**
 * §206. «Скачать PDF» — проверенная работа одним файлом.
 *
 * Кнопка стоит в общей оболочке разбора (`AttemptAnnotationOverlay`), которую
 * открывают и преподаватель, и ученик, поэтому правка здесь закрывает оба
 * случая сразу. У ученика кнопка появляется только после вердикта — правило
 * `canDownloadAttemptPdf`.
 *
 * Тяжёлая часть (отрисовка страниц и сборка байтов) грузится только по
 * нажатию: разбор и без того тянет pdfjs, добавлять к нему сборщик файла
 * всем, кто просто посмотрел пометки, незачем.
 */

import { useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from '@/store/toastStore'
import {
  attemptPdfFileName,
  canDownloadAttemptPdf,
  type AttemptPdfReport,
} from '@/lib/attemptPdfReport'
import type { AttemptExportSourceRef } from '@/lib/attemptPdfSource'

export type AttemptPdfAudience = 'staff' | 'student'

export function AttemptPdfButton({
  audience,
  report,
  sourceRef,
  quiet = false,
}: {
  audience: AttemptPdfAudience
  report: AttemptPdfReport | null
  sourceRef: AttemptExportSourceRef
  /**
   * §226. Тихий вид для шапки экрана проверки v2: без рамки, на телефоне
   * только значок (подпись — в `title` и для читалки).
   */
  quiet?: boolean
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const busyRef = useRef(false)

  if (!canDownloadAttemptPdf(audience, report) || !report) return null

  const busy = progress !== null

  async function download() {
    if (busyRef.current || !report) return
    const snapshot = sourceRef.current?.()
    // §209.1. Не только «есть ли хоть что-то», но и «всё ли открылось».
    // Фотографии появляются сразу, страницы PDF — через секунду-две, и в
    // этот промежуток слепок выглядит исправным, хотя половины работы в нём
    // нет. Отдать такой файл молча — хуже честного «подождите»: пропажу
    // заметит уже ученик, а преподаватель будет уверен, что отправил всё.
    if (!snapshot || snapshot.surfaces.length === 0 || !snapshot.ready) {
      toast.error('Страницы работы ещё не загрузились — подождите пару секунд и попробуйте снова')
      return
    }

    busyRef.current = true
    setProgress({ done: 0, total: snapshot.surfaces.length + 1 })
    try {
      const { buildAttemptPdf, downloadBlob } = await import('@/lib/attemptPdfRender')
      const blob = await buildAttemptPdf({
        snapshot,
        report,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      downloadBlob(blob, attemptPdfFileName(report.studentName, report.submittedAt))
    } catch (error) {
      // Либо файл целиком, либо ничего: скачанный огрызок хуже честной ошибки.
      const reason = error instanceof Error && error.message ? error.message : 'страница не отрисовалась'
      toast.error(
        `Не удалось собрать PDF: ${reason}. Попробуйте ещё раз или скачайте файлы работы по отдельности`,
      )
    } finally {
      busyRef.current = false
      setProgress(null)
    }
  }

  return (
    <button
      type="button"
      data-testid="attempt-pdf-download"
      disabled={busy}
      onClick={() => { void download() }}
      title="Скачать работу с пометками и разбором одним файлом"
      aria-label={quiet && !progress ? 'Скачать PDF' : undefined}
      className={quiet
        ? 'inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-graphite-500 transition-colors hover:bg-graphite-100 hover:text-graphite-900 disabled:pointer-events-none disabled:opacity-60'
        : 'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-primary-300 hover:text-primary-700 disabled:pointer-events-none disabled:opacity-60'}
    >
      {progress ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      {progress
        ? `Готовлю ${progress.done} из ${progress.total}`
        : quiet ? <span className="hidden sm:inline">Скачать PDF</span> : 'Скачать PDF'}
    </button>
  )
}
