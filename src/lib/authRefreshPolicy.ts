/**
 * 15.11. Что делать с событием авторизации, которое пришло для того же
 * человека, чей профиль уже загружен.
 *
 * Утро 14.11 (≈10 учеников, пул соединений PostgREST исчерпан): телефон
 * ученика при каждом возвращении на вкладку (переключился на калькулятор,
 * камеру, Telegram) получал от supabase-js событие авторизации — и сайт
 * заново читал `profiles` и звал `record_app_visit`. У одного iPhone это
 * было раз в 20–30 секунд без единого клика.
 *
 * Правило: профиль того же человека перечитываем не чаще раза в
 * PROFILE_FRESH_MS; USER_UPDATED (сменил имя, почту) — всегда; другой
 * человек или профиля нет — всегда. Отметку визита шлём раз в сутки (по
 * Москве) на устройство — сервер и так хранит одну строку в день.
 */

export const PROFILE_FRESH_MS = 10 * 60_000

export interface LoadedProfileMark {
  profileId: string | null
  loadedAt: number
}

export function shouldReloadProfile(
  event: string,
  userId: string,
  mark: LoadedProfileMark,
  now: number = Date.now(),
): boolean {
  if (event === 'USER_UPDATED') return true
  if (!mark.profileId || mark.profileId !== userId) return true
  return now - mark.loadedAt >= PROFILE_FRESH_MS
}

const VISIT_KEY_PREFIX = 'almiron:visit:'

/** Дата по Москве «ГГГГ-ММ-ДД» — граница суток та же, что у `record_app_visit`. */
export function moscowDay(now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now))
}

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): VisitStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

/**
 * Нужно ли сегодня звать `record_app_visit` для этого профиля. При true сразу
 * помечает день: повторный вызов в тот же день вернёт false. Нет доступа к
 * хранилищу (приватный режим) — true: лишний вызов дешевле потерянной отметки.
 */
export function claimDailyVisit(profileId: string, now: number = Date.now(), storage: VisitStorage | null = defaultStorage()): boolean {
  const day = moscowDay(now)
  if (!storage) return true
  try {
    const key = VISIT_KEY_PREFIX + profileId
    if (storage.getItem(key) === day) return false
    storage.setItem(key, day)
  } catch { /* хранилище недоступно — отмечаем как раньше */ }
  return true
}
