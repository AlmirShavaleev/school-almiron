import { useState } from 'react'
import { getSignedFileUrl, fileNameFromStoragePath, type PrivateBucket } from '@/lib/storage'

interface Props {
  bucket: PrivateBucket
  /** storage path or legacy full public URL from a *_url column */
  url: string | null | undefined
  className?: string
  /** Всплывающая подсказка. Ссылка часто ведёт на файл, который нельзя
   *  разметить, и объяснить это нужно до клика. */
  title?: string
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  /**
   * Скачать файл, а не открыть его в просмотрщике. `true` — имя берётся из
   * пути в Storage, строка — своё человеческое имя.
   *
   * По умолчанию остаётся открытие в новой вкладке: почти все ссылки в
   * проекте ведут на картинки и работы учеников, которые смотрят, а не
   * сохраняют. Скачивание включается там, где кнопка так и подписана.
   */
  download?: boolean | string
}

/**
 * Anchor for files in PRIVATE buckets. Resolves a fresh short-lived signed URL
 * at click time (not at render) so URLs never go stale in long-lived lists.
 */
export function SignedFileLink({ bucket, url, className, title, children, onClick, download }: Props) {
  const [busy, setBusy] = useState(false)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onClick?.(e)
    if (!url || busy) return
    setBusy(true)
    try {
      const downloadName = download
        ? (typeof download === 'string' ? download : fileNameFromStoragePath(url))
        : undefined
      const signed = await getSignedFileUrl(bucket, url, 3600, downloadName)
      if (!signed) return
      if (!downloadName) {
        window.open(signed, '_blank', 'noopener,noreferrer')
        return
      }
      // Ссылка уже отдаётся с Content-Disposition: attachment, поэтому клик по
      // временному якорю кладёт файл в загрузки, а не уводит со страницы.
      // Якорь добавляется в DOM: Safari не кликает по неприсоединённому.
      const anchor = document.createElement('a')
      anchor.href = signed
      anchor.download = downloadName
      anchor.rel = 'noopener'
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } catch (err: any) {
      alert(err?.message ?? 'Не удалось открыть файл')
    } finally {
      setBusy(false)
    }
  }

  return (
    <a href="#" onClick={handleClick} className={className} title={title} aria-busy={busy}>
      {children}
    </a>
  )
}
