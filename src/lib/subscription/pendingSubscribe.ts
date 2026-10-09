/**
 * §282. Гость выбрал тариф → регистрация → подтверждение почты → вход.
 * Куда вернуть после входа — запоминаем, как приглашения
 * (`teacherJoinLinkSession`): localStorage (письмо подтверждения часто
 * открывается в новой вкладке), сутки срока, только для ученика.
 */
const STORAGE_KEY = 'subscription-pending-tariff'
export const PENDING_SUBSCRIBE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function savePendingSubscribe(tariffId: string): void {
  if (!UUID_RE.test(tariffId)) return
  storage()?.setItem(STORAGE_KEY, JSON.stringify({ tariffId, savedAt: Date.now() }))
}

export function clearPendingSubscribe(): void {
  storage()?.removeItem(STORAGE_KEY)
}

export function readPendingSubscribe(now: number = Date.now()): string | null {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { tariffId?: unknown; savedAt?: unknown }
    if (typeof v.tariffId !== 'string' || !UUID_RE.test(v.tariffId) || typeof v.savedAt !== 'number') throw new Error('bad')
    if (now - v.savedAt > PENDING_SUBSCRIBE_MAX_AGE_MS) throw new Error('old')
    return v.tariffId
  } catch {
    clearPendingSubscribe()
    return null
  }
}

/**
 * Путь оформления, если он ждёт. Роль: null — «ещё не знаем» (профиль едет),
 * путь отдаём; не ученик — запись чистим, персоналу она не нужна.
 */
export function getPendingSubscribePath(role?: string | null): string | null {
  const tariffId = readPendingSubscribe()
  if (!tariffId) return null
  if (role != null && role !== 'student') {
    clearPendingSubscribe()
    return null
  }
  return `/subscribe/checkout/${tariffId}`
}
