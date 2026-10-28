/**
 * Место на странице, куда вернуть человека: раздел и прокрутка, по адресу
 * страницы. Письма 27.10 про телефон: ▶ в уроке уводит на отдельную страницу
 * видео, «назад» обязан вернуть в урок туда же, а не в начало. sessionStorage —
 * на вкладку; где он запрещён (встроенные браузеры), молча ничего не помним.
 */
export interface PagePosition {
  /** Открытый раздел (вкладка) страницы. */
  tab?: string | null
  /** window.scrollY. */
  y?: number
}

const PREFIX = 'page-pos:'

export function readPagePosition(path: string): PagePosition | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + path)
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' ? v as PagePosition : null
  } catch {
    return null
  }
}

export function savePagePosition(path: string, patch: PagePosition): void {
  try {
    sessionStorage.setItem(PREFIX + path, JSON.stringify({ ...readPagePosition(path), ...patch }))
  } catch { /* нет хранилища — не помним */ }
}

/** Прокрутку отдали — второй раз не прыгаем (раздел помним дальше). */
export function takeScrollPosition(path: string): number | null {
  const pos = readPagePosition(path)
  if (!pos || typeof pos.y !== 'number' || pos.y <= 0) return null
  savePagePosition(path, { y: 0 })
  return pos.y
}
