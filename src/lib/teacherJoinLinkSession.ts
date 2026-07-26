// Storage for the "permanent teacher registration link" intent. Deliberately separate from
// studentInviteSession's key: the old group-bound invite and the new teacher join link are
// different flows with different resume semantics.
//
// Uses localStorage, not sessionStorage: the email-confirmation link Supabase sends opens in
// whatever tab the user clicks it in -- often a NEW tab/window, which has its own empty
// sessionStorage. localStorage is shared across tabs of the same origin, so the intent
// survives that hop (and reload, and navigating to /register or /login) instead of silently
// vanishing and leaving the student registered but never actually submitted to the teacher.
const STORAGE_KEY = 'teacher-join-link-pending'

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function savePendingTeacherJoinLink(token: string): void {
  const storage = safeStorage()
  if (!storage) return
  storage.setItem(STORAGE_KEY, token)
}

export function readPendingTeacherJoinLink(): string | null {
  const storage = safeStorage()
  if (!storage) return null
  return storage.getItem(STORAGE_KEY)
}

export function clearPendingTeacherJoinLink(): void {
  const storage = safeStorage()
  if (!storage) return
  storage.removeItem(STORAGE_KEY)
}

export function hasPendingTeacherJoinLink(): boolean {
  return !!readPendingTeacherJoinLink()
}

export function getPendingTeacherJoinLinkPath(): string | null {
  const token = readPendingTeacherJoinLink()
  return token ? `/jt/${token}` : null
}
