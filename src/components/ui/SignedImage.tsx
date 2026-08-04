import { useCallback, useEffect, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import { getSignedFileUrl, type PrivateBucket } from '@/lib/storage'
import { cn } from '@/utils/cn'

/**
 * Картинка из ПРИВАТНОГО бакета.
 *
 * `SignedFileLink` рядом получает ссылку по клику — для ссылки это правильно,
 * ссылка не должна протухать в длинном списке. Картинку же показать без ссылки
 * нельзя, поэтому здесь она берётся при появлении на экране.
 *
 * Ссылка живёт час, а вкладку с темой держат открытой дольше. Поэтому при
 * ошибке загрузки — одна повторная подпись: протухшая ссылка чинится сама,
 * а битый файл честно показывает заглушку, а не вечный спиннер.
 */
export function SignedImage({
  bucket,
  path,
  alt,
  className,
}: {
  bucket: PrivateBucket
  path: string | null | undefined
  alt: string
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [retried, setRetried] = useState(false)

  const sign = useCallback(async () => {
    if (!path) { setState('failed'); return }
    try {
      const signed = await getSignedFileUrl(bucket, path)
      if (!signed) { setState('failed'); return }
      setUrl(signed)
    } catch {
      setState('failed')
    }
  }, [bucket, path])

  useEffect(() => {
    setState('loading')
    setRetried(false)
    setUrl(null)
    void sign()
  }, [sign])

  function handleError() {
    if (retried) { setState('failed'); return }
    setRetried(true)
    setUrl(null)
    void sign()
  }

  if (state === 'failed') {
    return (
      <div className={cn('flex items-center justify-center gap-2 rounded-lg bg-gray-100 py-6 text-xs text-gray-400', className)}>
        <ImageOff size={14} />
        Не удалось показать изображение
      </div>
    )
  }

  return (
    <>
      {state === 'loading' && (
        <div className={cn('flex items-center justify-center rounded-lg bg-gray-50 py-6', className)}>
          <Loader2 size={16} className="animate-spin text-gray-300" />
        </div>
      )}
      {url && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onLoad={() => setState('ready')}
          onError={handleError}
          className={cn(state === 'ready' ? className : 'hidden')}
        />
      )}
    </>
  )
}
