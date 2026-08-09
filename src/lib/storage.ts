import { supabase } from '@/lib/supabase'

/**
 * Private-bucket file access helpers.
 *
 * Buckets `homeworks` and `course-materials` are PRIVATE. Files must be served
 * via short-lived signed URLs, never public URLs. Older DB rows may still hold
 * full public URLs in *_url columns; extractStoragePath() normalizes those to a
 * storage path so getSignedFileUrl() can re-sign them on demand.
 */

export type PrivateBucket = 'homeworks' | 'course-materials' | 'lesson-library' | 'topic-materials' | 'course-lesson-materials' | 'topic-homework' | 'topic-homework-attempts'

/**
 * Extract the storage object path from a value that may be either:
 *  - a full Supabase public URL (.../object/public/{bucket}/{path})
 *  - a full signed URL (.../object/sign/{bucket}/{path}?token=...)
 *  - an already-bare storage path ({path})
 *
 * Domain-agnostic: parses by the `/object/{public|sign}/{bucket}/` marker so it
 * works regardless of project domain or custom storage host. Returns null for
 * empty input. If the value is already a bare path, it is returned unchanged.
 */
export function extractStoragePath(value: string | null | undefined, bucket: PrivateBucket): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null

  // Full URL for either public or signed object endpoint.
  for (const kind of ['public', 'sign'] as const) {
    const marker = `/object/${kind}/${bucket}/`
    const idx = v.indexOf(marker)
    if (idx !== -1) {
      let path = v.slice(idx + marker.length)
      const q = path.indexOf('?')
      if (q !== -1) path = path.slice(0, q) // drop ?token=... etc.
      return decodeURIComponent(path)
    }
  }

  // Not a recognized storage URL. If it looks like some other absolute URL,
  // we cannot sign it — return as-is and let the caller decide. Otherwise it is
  // already a bare storage path.
  return v
}

/**
 * Cache-Control для загружаемых файлов (§105).
 *
 * Путь в Storage неизменяем: имя строится из метки времени, а «замена файла»
 * заливает НОВЫЙ объект и переключает строку (§101–§102). Значит, содержимое по
 * адресу не меняется никогда, и год кэша безопасен. Умолчание Storage —
 * max-age=3600, а через подписанную загрузку по XHR заголовок вовсе не
 * ставился, и объекты приезжали с `no-cache`.
 */
export const UPLOAD_CACHE_CONTROL_S = '31536000'

/** Сколько живёт обычная подписанная ссылка. */
export const SIGNED_URL_TTL_S = 3600

/**
 * Срок для файлов под гейтом «Решения ДЗ» (§95).
 *
 * Подписанная ссылка — пропуск на предъявителя: она работает, пока не истекла,
 * даже если право уже отобрали. Для решения это существенно, поэтому час там
 * не годится: пять минут дают тот же кэш в пределах одного просмотра, но не
 * пережидают снятие доступа.
 */
export const SHORT_SIGNED_URL_TTL_S = 300

/**
 * Запас на дорогу и часы клиента: ссылку, которой осталось меньше, считаем
 * протухшей и подписываем заново. Иначе большой PDF мог бы начать грузиться за
 * секунду до конца срока и оборваться на середине.
 */
const EXPIRY_MARGIN_S = 60

interface CachedUrl {
  url: string
  /** Момент, после которого ссылку переиспользовать нельзя. */
  goodUntilMs: number
}

/**
 * Кэш выданных ссылок — суть §105.
 *
 * `createSignedUrl` каждый раз возвращает НОВЫЙ url (новый token в query), а
 * браузерный кэш ключуется по url целиком. Значит, при каждом показе одного и
 * того же PDF браузер видел новый адрес и качал файл заново: `Cache-Control:
 * max-age=3600` на объекте не срабатывал ни разу.
 *
 * Ключ — бакет, путь, срок и имя для скачивания. Первый уровень — память
 * вкладки, второй (только для обычных ссылок) — sessionStorage, чтобы F5 не
 * стоил ученику повторной закачки всей темы. HTTP-кэш браузера при этом
 * отдаёт файл без сети, пока адрес совпадает.
 */
const urlCache = new Map<string, CachedUrl>()

/**
 * Подписи, которые прямо сейчас в полёте. Тема открывает десяток файлов разом,
 * а панель решения показывает те же файлы второй раз: без этого на один путь
 * уходило бы несколько одинаковых запросов, и каждый вернул бы СВОЙ url — то
 * есть снова мимо кэша.
 */
const inflight = new Map<string, Promise<string | null>>()

function cacheKey(bucket: string, path: string, expiresIn: number, downloadName?: string): string {
  return `${bucket}|${path}|${expiresIn}|${downloadName ?? ''}`
}

/**
 * Ссылки переживают перезагрузку страницы — но только обычные.
 *
 * Без этого весь выигрыш §105 держался бы на памяти вкладки: F5 — и ученик
 * снова качает всю тему. Хранилище именно `sessionStorage`: оно умирает вместе
 * с вкладкой и не остаётся на диске после закрытия, в отличие от
 * `localStorage`. Подписанная ссылка — пропуск на предъявителя, и жить дольше
 * сессии она не должна.
 *
 * Файлы под гейтом (короткий срок) сюда НЕ попадают вовсе: у них весь смысл в
 * том, чтобы пропуск быстро терял силу.
 */
const SESSION_PREFIX = 'signed-url:'

function sessionGet(key: string): CachedUrl | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedUrl
    if (typeof parsed?.url !== 'string' || typeof parsed?.goodUntilMs !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function sessionSet(key: string, entry: CachedUrl, expiresIn: number): void {
  if (expiresIn <= SHORT_SIGNED_URL_TTL_S) return
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Переполнение или запрет хранилища — не повод ронять показ файла.
  }
}

function sessionDelete(key: string): void {
  try {
    sessionStorage.removeItem(SESSION_PREFIX + key)
  } catch {
    // см. выше
  }
}

/**
 * Забыть выданную ссылку. Нужно там, где файл не открылся: возможно, ссылка
 * перестала работать раньше срока (сменились права, объект перезалит), и
 * повтор обязан пойти за новой подписью, а не достать из кэша ту же самую.
 */
export function forgetSignedUrl(bucket: PrivateBucket, path: string | null | undefined): void {
  const clean = extractStoragePath(path, bucket)
  if (!clean) return
  const prefix = `${bucket}|${clean}|`
  for (const key of [...urlCache.keys()]) {
    if (key.startsWith(prefix)) urlCache.delete(key)
  }
  // И из переживающего перезагрузку хранилища тоже: иначе после F5 вернулась
  // бы ровно та ссылка, по которой файл не открылся.
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(SESSION_PREFIX + prefix)) sessionStorage.removeItem(k)
    }
  } catch {
    // хранилище недоступно — в памяти уже почистили
  }
}

/** Только для тестов: полностью очистить кэш ссылок. */
export function clearSignedUrlCache(): void {
  urlCache.clear()
  inflight.clear()
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(k)
    }
  } catch {
    // хранилища нет — и хорошо
  }
}

/**
 * Create a short-lived signed URL for a private-bucket object.
 *
 * Ссылка переиспользуется, пока жива: тот же адрес — тот же ключ браузерного
 * кэша, и второй показ файла не стоит ни байта (§105).
 *
 * @param path storage path or a full public/signed URL (normalized internally)
 * @param expiresIn seconds the URL stays valid (default 1h)
 */
export async function getSignedFileUrl(
  bucket: PrivateBucket,
  path: string | null | undefined,
  expiresIn = SIGNED_URL_TTL_S,
  downloadName?: string,
): Promise<string | null> {
  const clean = extractStoragePath(path, bucket)
  if (!clean) return null
  // If it's some foreign absolute URL we can't sign, return it untouched.
  if (/^https?:\/\//i.test(clean)) return clean

  const key = cacheKey(bucket, clean, expiresIn, downloadName)

  const cached = urlCache.get(key) ?? sessionGet(key)
  if (cached && cached.goodUntilMs > Date.now()) {
    urlCache.set(key, cached)
    return cached.url
  }
  if (cached) {
    urlCache.delete(key)
    sessionDelete(key)
  }

  const pending = inflight.get(key)
  if (pending) return pending

  // downloadName просит Storage отдать файл с Content-Disposition: attachment
  // и этим именем. Без него PDF и картинки открываются во встроенном
  // просмотрщике: атрибута download на ссылке недостаточно, он игнорируется
  // для чужого origin (файлы отдаёт домен Supabase, а не наш).
  const request = supabase.storage
    .from(bucket)
    .createSignedUrl(clean, expiresIn, downloadName ? { download: downloadName } : undefined)
    .then(({ data, error }) => {
      if (error || !data) throw new Error('Не удалось получить ссылку на файл: ' + (error?.message ?? 'unknown'))
      const entry: CachedUrl = {
        url: data.signedUrl,
        goodUntilMs: Date.now() + Math.max(0, expiresIn - EXPIRY_MARGIN_S) * 1000,
      }
      urlCache.set(key, entry)
      sessionSet(key, entry, expiresIn)
      return data.signedUrl
    })
    .finally(() => { inflight.delete(key) })

  inflight.set(key, request)
  return request
}

/**
 * Имя файла для скачивания: последний сегмент пути в Storage.
 * Пути вида `submissions/<uuid>/attempt-1.pdf` дают «attempt-1.pdf» —
 * читаемее, чем весь путь, и не раскрывает структуру бакета.
 */
export function fileNameFromStoragePath(path: string | null | undefined, fallback = 'file'): string {
  const clean = (path ?? '').split('?')[0].split('/').filter(Boolean).pop()
  return clean ? decodeURIComponent(clean) : fallback
}
