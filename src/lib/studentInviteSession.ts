const STORAGE_KEY = 'student-invite-pending'

export type PendingInvite =
  | { type: 'token'; value: string }
  | { type: 'code'; value: string }

function safeSessionStorage(): Storage | null {
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
  const storage = safeSessionStorage()
  if (!storage) return
  storage.setItem(STORAGE_KEY, JSON.stringify(invite))
}

export function readPendingInvite(): PendingInvite | null {
  const storage = safeSessionStorage()
  if (!storage) return null
  const raw = storage.getItem(STORAGE_KEY)
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

export function clearPendingInvite(): void {
  const storage = safeSessionStorage()
  if (!storage) return
  storage.removeItem(STORAGE_KEY)
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
