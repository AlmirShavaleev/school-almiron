import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import {
  forgetSignedUrl, getSignedFileUrl,
  SHORT_SIGNED_URL_TTL_S, SIGNED_URL_TTL_S,
  type PrivateBucket,
} from '@/lib/storage'
import { cn } from '@/utils/cn'

/** Сколько ждём подпись и саму картинку, прежде чем показать заглушку. */
const SIGN_TIMEOUT_MS = 10_000
const LOAD_TIMEOUT_MS = 15_000

/**
 * Картинка из ПРИВАТНОГО бакета.
 *
 * `SignedFileLink` рядом получает ссылку по клику — для ссылки это правильно,
 * она не должна протухать в длинном списке. Картинку без ссылки не покажешь,
 * поэтому здесь она берётся при появлении на экране. Ссылка живёт час, а
 * вкладку держат открытой дольше, поэтому при ошибке загрузки делается одна
 * повторная подпись.
 *
 * ДВА правила, купленные вечным спиннером на проде (§97):
 *
 *  1. **Никакого `loading="lazy"`.** С ним браузер не присылает НИ `load`, НИ
 *     `error` — проверено в браузере: скрытая и видимая картинки с `lazy`
 *     молчат обе, без `lazy` ошибка приходит сразу. Компонент ждал `onLoad`,
 *     чтобы показать картинку, а показать её был должен, чтобы `onLoad`
 *     случился, — и висел вечно.
 *  2. **Картинка не прячется, пока грузится.** `display:none` — та же ловушка с
 *     другой стороны; пока не готова, она просто прозрачная, но в потоке.
 *
 * И на всё остальное — таймауты: любой исход, включая «сеть молчит», обязан
 * закончиться картинкой или заглушкой, но не спиннером навсегда.
 */
export function SignedImage({
  bucket,
  path,
  alt,
  className,
  sensitive = false,
}: {
  bucket: PrivateBucket
  path: string | null | undefined
  alt: string
  className?: string
  /**
   * Файл под гейтом (рубрика «Решения ДЗ», §95). Ссылка на него живёт пять
   * минут вместо часа: выданный пропуск работает до конца срока, даже если
   * право уже отобрали (§105).
   */
  sensitive?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'signing' | 'loading' | 'ready' | 'failed'>('signing')
  const retriedRef = useRef(false)

  const sign = useCallback(async () => {
    if (!path) { setState('failed'); return }
    try {
      const signed = await Promise.race([
        getSignedFileUrl(bucket, path, sensitive ? SHORT_SIGNED_URL_TTL_S : SIGNED_URL_TTL_S),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), SIGN_TIMEOUT_MS)),
      ])
      if (!signed) { setState('failed'); return }
      setUrl(signed)
      setState('loading')
    } catch {
      setState('failed')
    }
  }, [bucket, path, sensitive])

  useEffect(() => {
    retriedRef.current = false
    setUrl(null)
    setState('signing')
    void sign()
  }, [sign])

  // Сторож на саму загрузку: если картинка не приехала и не упала, всё равно
  // показываем заглушку. Спиннер без конца — худший из исходов.
  useEffect(() => {
    if (state !== 'loading') return
    const t = setTimeout(() => setState('failed'), LOAD_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [state, url])

  function handleError() {
    // Одна повторная подпись: протухшая ссылка чинится сама, битый файл
    // честно показывает заглушку.
    if (retriedRef.current) { setState('failed'); return }
    retriedRef.current = true
    // Ссылку из кэша забываем: раз она не сработала, повтор должен идти за
    // новой подписью, а не доставать ту же самую (§105).
    forgetSignedUrl(bucket, path)
    setUrl(null)
    setState('signing')
    void sign()
  }

  if (state === 'failed') {
    return (
      <div
        data-testid="signed-image-failed"
        className={cn('flex items-center justify-center gap-2 rounded-lg bg-gray-100 py-6 text-xs text-gray-400', className)}
      >
        <ImageOff size={14} />
        Не удалось показать изображение
      </div>
    )
  }

  if (state === 'signing' || !url) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg bg-gray-50 py-6', className)}>
        <Loader2 size={16} className="animate-spin text-gray-300" />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      data-testid="signed-image"
      onLoad={() => setState('ready')}
      onError={handleError}
      // Прозрачная, но в потоке: скрытая картинка не грузится, а значит и не
      // сообщает о готовности.
      className={cn(className, state !== 'ready' && 'opacity-0')}
    />
  )
}
