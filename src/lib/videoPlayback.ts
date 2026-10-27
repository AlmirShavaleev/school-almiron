import { useSyncExternalStore } from 'react'

/**
 * Один живой плеер на странице (письмо ЛК_СРОЧНО_видео_на_телефоне_роняет_страницу.md,
 * 27.10): в уроке до 8 видео, и каждое было отдельным iframe Bunny со своим
 * плеером и HLS. На телефоне запуск декодера поверх всего этого — и браузер
 * убивал вкладку по памяти. Теперь iframe создаётся только по нажатию ▶, и
 * живой — ровно один: запуск второго снимает первый (его просмотр перед этим
 * дописывается — cleanup `useVideoWatch` делает flush).
 */
let active: string | null = null
const listeners = new Set<() => void>()

function emit() { for (const l of listeners) l() }

export function setActiveVideo(id: string | null): void {
  if (active === id) return
  active = id
  emit()
}

/** Снять активный плеер, только если это он (свернули раздел, ушли со вкладки). */
export function releaseVideo(id: string): void {
  if (active === id) setActiveVideo(null)
}

const mounted = new Map<string, number>()

/**
 * Карточка с этим роликом на странице. Возвращает снятие: когда последняя
 * карточка ролика ушла, плеер снимается. Проверка — после коммита: страница,
 * дорисовав данные, может пересоздать карточку того же ролика, и нажатый ▶
 * не должен от этого гаснуть.
 */
export function mountVideo(id: string): () => void {
  mounted.set(id, (mounted.get(id) ?? 0) + 1)
  return () => {
    const n = (mounted.get(id) ?? 1) - 1
    if (n > 0) mounted.set(id, n)
    else mounted.delete(id)
    queueMicrotask(() => { if (!mounted.has(id)) releaseVideo(id) })
  }
}

export function activeVideo(): string | null {
  return active
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Активен ли этот плеер сейчас. */
export function useIsActiveVideo(id: string): boolean {
  return useSyncExternalStore(subscribe, () => active === id, () => false)
}

/**
 * Адрес плеера для запуска по нажатию: сразу играть, не тянуть видео заранее.
 * Bunny — `autoplay=true&preload=false`; YouTube/Vimeo — `autoplay=1`.
 */
export function playUrl(embed: string): string {
  try {
    const u = new URL(embed)
    if (u.hostname.endsWith('mediadelivery.net')) {
      u.searchParams.set('autoplay', 'true')
      u.searchParams.set('preload', 'false')
    } else {
      u.searchParams.set('autoplay', '1')
    }
    return u.toString()
  } catch {
    return embed
  }
}

/** guid ролика Bunny из embed-адреса `iframe.mediadelivery.net/embed/<lib>/<guid>`. */
export function bunnyGuidOf(embed: string): string | null {
  const m = embed.match(/mediadelivery\.net\/(?:embed|play)\/\d+\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}

/** Для тестов. */
export function resetActiveVideo(): void { active = null; mounted.clear(); emit() }
;(globalThis as { __resetActiveVideo?: () => void }).__resetActiveVideo = resetActiveVideo
