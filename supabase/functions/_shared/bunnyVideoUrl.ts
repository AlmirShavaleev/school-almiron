/**
 * Разбор адреса видео Bunny Stream — одна копия на клиент и edge-функцию.
 *
 * Плеер платформы (`TopicPage`) и статистика просмотров (`bunny-video-stats`,
 * §146) понимают ровно один вид адреса:
 *   `https://iframe.mediadelivery.net/embed/<library>/<guid>`
 * Панель Bunny при этом даёт скопировать ещё три: страницу «play», прямой
 * поток с CDN и голый идентификатор. 12.09 два таких адреса были прикреплены
 * к темам руками, форма их приняла молча, плеер их не показал, статистика не
 * посчитала (§168). Отсюда правило: всё, что узнаётся как Bunny, приводится к
 * embed-виду ДО записи в базу; остальное не трогается — внешние ссылки
 * (YouTube, Vimeo, RuTube) бывают.
 *
 * Модуль лежит в `_shared`, а не в `src/lib`, потому что edge-функция при
 * деплое видит только `supabase/functions/`; клиент берёт его через
 * `src/lib/bunnyVideoUrl.ts`. Deno-специфичного здесь нет и быть не должно.
 */

/** Наша библиотека Bunny (§146). Подставляется, когда в адресе номера нет. */
export const BUNNY_DEFAULT_LIBRARY_ID = '726880'

/** Идентификатор видео Bunny — UUID. Регистр не важен, храним строчными. */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface BunnyVideoRef {
  /** Номер библиотеки из адреса; null, если адрес его не несёт (CDN, голый guid). */
  libraryId: string | null
  guid: string
}

function asGuid(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  return GUID_RE.test(v) ? v.toLowerCase() : null
}

/**
 * Узнаёт видео Bunny в строке. Понимает:
 *   - `iframe.mediadelivery.net/embed/<library>/<guid>` (наш рабочий вид);
 *   - `player.mediadelivery.net/play/<library>/<guid>` (страница «play»);
 *   - `vz-<…>.b-cdn.net/<guid>/playlist.m3u8` и любой другой путь CDN,
 *     начинающийся с guid (`/<guid>/play_720p.mp4`, `/<guid>/thumbnail.jpg`);
 *   - голый `<guid>`.
 * Всё прочее — null: это не Bunny, и решать за такую ссылку мы не берёмся.
 */
export function parseBunnyVideoUrl(raw: string | null | undefined): BunnyVideoRef | null {
  const input = (raw ?? '').trim()
  if (!input) return null

  const bare = asGuid(input)
  if (bare) return { libraryId: null, guid: bare }

  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === 'iframe.mediadelivery.net' || host === 'player.mediadelivery.net') {
    // /embed/<library>/<guid> и /play/<library>/<guid> — одна форма, разные глаголы.
    const [verb, library, guid] = segments
    if ((verb === 'embed' || verb === 'play') && /^\d+$/.test(library ?? '')) {
      const id = asGuid(guid)
      return id ? { libraryId: library, guid: id } : null
    }
    return null
  }

  if (host.endsWith('.b-cdn.net')) {
    // Прямой поток: первый сегмент пути — guid, дальше playlist.m3u8 и т. п.
    // Номера библиотеки в таком адресе нет — только зона `vz-<имя>`.
    const id = asGuid(segments[0])
    return id ? { libraryId: null, guid: id } : null
  }

  return null
}

/** Рабочий вид адреса: тот, что у остальных ~350 видео платформы. */
export function bunnyEmbedUrl(guid: string, libraryId: string = BUNNY_DEFAULT_LIBRARY_ID): string {
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${guid}`
}

/**
 * Приводит адрес Bunny к embed-виду. Библиотека — из адреса, если есть,
 * иначе наша. Не Bunny — null, чтобы вызывающий оставил строку как есть.
 */
export function normalizeBunnyVideoUrl(raw: string | null | undefined): string | null {
  const ref = parseBunnyVideoUrl(raw)
  return ref ? bunnyEmbedUrl(ref.guid, ref.libraryId ?? BUNNY_DEFAULT_LIBRARY_ID) : null
}
