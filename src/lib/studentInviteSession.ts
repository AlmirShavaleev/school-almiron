// Намерение «я пришёл по ссылке курса и хочу вступить». Хранится в
// localStorage, а НЕ в sessionStorage: ссылка подтверждения почты открывается в
// той вкладке, в которой человек кликнул письмо, — обычно в новой, а у неё своя
// пустая sessionStorage. Приглашение при этом молча исчезало, и человек
// оказывался зарегистрирован, но никуда не вступившим (наблюдалось на проде:
// профиль есть, групп ноль). Тот же вывод уже был сделан для преподавательской
// ссылки — см. комментарий в teacherJoinLinkSession; здесь его просто забыли
// применить ко второму контуру.
//
// Плата за долгую жизнь записи — риск, что чужое приглашение всплывёт месяцем
// позже на том же компьютере. Поэтому запись обязана вычищаться сразу после
// успешного вступления (clearPendingInvite в JoinPage) и на любом окончательном
// отказе (использовано / отозвано / истекло).
const STORAGE_KEY = 'student-invite-pending'

export type PendingInvite =
  | { type: 'token'; value: string }
  | { type: 'code'; value: string }

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * Прежнее место хранения. Нужно ровно на один переход: человек, начавший
 * регистрацию до деплоя, держит приглашение в sessionStorage своей вкладки —
 * без этого чтения оно бы пропало у него на середине пути.
 */
function safeLegacyStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

export function normalizeInviteCode(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase()
}

export function formatInviteCode(value: string): string {
  const normalized = normalizeInviteCode(value)
  return normalized.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}

export function savePendingInvite(invite: PendingInvite): void {
  const storage = safeStorage()
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(invite))
}

function parseInvite(raw: string | null): PendingInvite | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PendingInvite
    if (!parsed || (parsed.type !== 'token' && parsed.type !== 'code') || typeof parsed.value !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function readPendingInvite(): PendingInvite | null {
  const storage = safeStorage()
  const current = parseInvite(storage?.getItem(STORAGE_KEY) ?? null)
  if (current) return current

  // Хвост прежнего хранения: переносим в localStorage и убираем из старого
  // места, чтобы одна и та же запись не жила в двух хранилищах.
  const legacy = safeLegacyStorage()
  const migrated = parseInvite(legacy?.getItem(STORAGE_KEY) ?? null)
  if (!migrated) return null
  legacy?.removeItem(STORAGE_KEY)
  storage?.setItem(STORAGE_KEY, JSON.stringify(migrated))
  return migrated
}

export function clearPendingInvite(): void {
  // Из обоих хранилищ: иначе перенесённая запись воскресла бы после уборки.
  safeStorage()?.removeItem(STORAGE_KEY)
  safeLegacyStorage()?.removeItem(STORAGE_KEY)
}

export function hasPendingInvite(): boolean {
  return !!readPendingInvite()
}

export function getPendingInvitePath(): string | null {
  const invite = readPendingInvite()
  if (!invite) return null
  if (invite.type === 'token') return `/join/${invite.value}`
  return '/join'
}
