import { useState } from 'react'
import { getSignedFileUrl, type PrivateBucket } from '@/lib/storage'

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
}

/**
 * Anchor for files in PRIVATE buckets. Resolves a fresh short-lived signed URL
 * at click time (not at render) so URLs never go stale in long-lived lists.
 */
export function SignedFileLink({ bucket, url, className, title, children, onClick }: Props) {
  const [busy, setBusy] = useState(false)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onClick?.(e)
    if (!url || busy) return
    setBusy(true)
    try {
      const signed = await getSignedFileUrl(bucket, url)
      if (signed) window.open(signed, '_blank', 'noopener,noreferrer')
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
