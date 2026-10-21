import { lazy, type ComponentType } from 'react'
import { noteError, noteReload } from '@/lib/perf/rum'

/**
 * Почему это нужно.
 *
 * После разбиения бандла постранично (PROJECT_STATE §25.3) страницы грузятся
 * отдельными файлами с хешем в имени: `MyTopicHomeworkPage-B4x7W2Ut.js`.
 * Вкладка, открытая ДО деплоя, держит в памяти старый код со старыми именами.
 * Выходит новый деплой — имена меняются, старых файлов на сервере больше нет.
 * Пользователь переходит на страницу, браузер просит файл со старым хешем,
 * получает 404 и роняет приложение с «Failed to fetch dynamically imported
 * module». Лечится перезагрузкой: свежий index.html принесёт новые имена.
 *
 * Защита от цикла перезагрузок (письмо ЛК_СРОЧНО_урок_перезагрузка_НЕ_исправлено.md,
 * 21.10: у учеников урок перезагружался каждые 2–3 с, 5 раз подряд). Раньше
 * защитой был один флаг в sessionStorage, который снимался после удачной
 * загрузки, — цикл оставался возможен:
 *  · sessionStorage недоступен или не переживает перезагрузку (встроенные
 *    браузеры приложений) — флага нет вовсе;
 *  · браузер отдаёт из кэша старый index.html — перезагрузка приносит те же
 *    старые имена файлов, а флаги разных чанков снимают друг друга.
 * Теперь:
 *  · автоперезагрузка — не чаще одной за RELOAD_COOLDOWN_MS на вкладку, отметка
 *    времени — в `window.name` (переживает перезагрузку без всякого хранилища)
 *    и дублем в localStorage; удачная загрузка её НЕ снимает;
 *  · перезагрузка — переходом на тот же адрес с `?_r=<время>`: так браузер
 *    обязан взять index.html из сети, а не из кэша; параметр потом убирается;
 *  · перед перезагрузкой — событие в RUM (`reload chunk:<имя>`), после отказа —
 *    `error` с текстом, чтобы причина была видна в perf_events.
 * Второй сбой за окно — честная ошибка (её покажет граница ошибок с кнопкой
 * «Обновить»), а не новая перезагрузка.
 */
export const RELOAD_COOLDOWN_MS = 120_000
const MARK = 'almiron-chunk-reload:'
const LS_KEY = 'almiron:chunk-reload-at'
export const BUST_PARAM = '_r'

export function lazyPage<T extends ComponentType<any>>(
  name: string,
  load: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await load()
    } catch (error) {
      if (!isChunkLoadError(error)) throw error
      if (!mayAutoReload(Date.now())) {
        noteError(`chunk ${name} after reload: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
      markAutoReload(Date.now())
      noteReload(`chunk:${name}`)
      reloadFresh()
      // Страница уже перезагружается — отдаём промис, который никогда не
      // разрешится, чтобы React не успел показать вспышку ошибки.
      return new Promise<never>(() => {})
    }
  })
}

/**
 * Отличаем «файл чанка не доехал» от настоящей ошибки внутри модуля.
 * Перезагружать имеет смысл только первое: если модуль упал при вычислении,
 * перезагрузка ничего не починит, а сообщение об ошибке будет потеряно.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \S+ failed/i.test(message)
}

/** Когда была последняя автоперезагрузка этой вкладки (0 — не было). */
export function lastAutoReload(): number {
  let at = 0
  try {
    const m = window.name.match(new RegExp(`${MARK}(\\d+)`))
    if (m) at = Number(m[1])
  } catch { /* нет window.name — смотрим хранилище */ }
  try {
    at = Math.max(at, Number(window.localStorage.getItem(LS_KEY)) || 0)
  } catch { /* хранилище недоступно — хватит window.name */ }
  return at
}

export function mayAutoReload(now: number): boolean {
  return now - lastAutoReload() >= RELOAD_COOLDOWN_MS
}

export function markAutoReload(now: number): void {
  try {
    const rest = window.name.replace(new RegExp(`${MARK}\\d+`, 'g'), '')
    window.name = `${rest}${MARK}${now}`
  } catch { /* не критично */ }
  try { window.localStorage.setItem(LS_KEY, String(now)) } catch { /* не критично */ }
}

/** Тот же адрес с `?_r=<время>`: index.html — из сети, не из кэша браузера. */
export function freshUrl(href: string, now: number = Date.now()): string {
  const u = new URL(href)
  u.searchParams.set(BUST_PARAM, String(now))
  return u.toString()
}

function reloadFresh(): void {
  try {
    window.location.replace(freshUrl(window.location.href))
  } catch {
    window.location.reload()
  }
}

/** После перезагрузки убрать `?_r=` из адресной строки (без перехода). */
export function stripBustParam(): void {
  try {
    const u = new URL(window.location.href)
    if (!u.searchParams.has(BUST_PARAM)) return
    u.searchParams.delete(BUST_PARAM)
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
  } catch { /* не критично */ }
}
