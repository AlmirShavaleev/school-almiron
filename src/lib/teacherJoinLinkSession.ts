// Storage for the "permanent teacher registration link" intent. Deliberately separate from
// studentInviteSession's key: the old group-bound invite and the new teacher join link are
// different flows with different resume semantics.
//
// Uses localStorage, not sessionStorage: the email-confirmation link Supabase sends opens in
// whatever tab the user clicks it in -- often a NEW tab/window, which has its own empty
// sessionStorage. localStorage is shared across tabs of the same origin, so the intent
// survives that hop (and reload, and navigating to /register or /login) instead of silently
// vanishing and leaving the student registered but never actually submitted to the teacher.
//
// Пределы — те же два, что и у ученического приглашения, и по той же причине
// (у владельца сохранённая запись перехватила главную навсегда, разбор в
// `studentInviteSession`): запись живёт сутки и не касается тех, чья роль не
// ученическая. Ссылка ведёт к «стать учеником этого преподавателя» — учителю,
// админу или куратору она не пригодится ни при каком развитии событий.
const STORAGE_KEY = 'teacher-join-link-pending'

/** Сутки — как у ученического приглашения, чтобы правило было одно. */
export const TEACHER_JOIN_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StoredTeacherJoinLink {
  token: string
  savedAt: number
}

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
  const stored: StoredTeacherJoinLink = { token, savedAt: Date.now() }
  storage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

/**
 * Раньше здесь лежала голая строка токена. Читаем оба вида: у людей, начавших
 * путь до этой правки, в браузере именно строка, и потерять её значило бы
 * заново сломать то, что чинилось переездом в localStorage. Старой записи
 * ставится отметка «сейчас» — сутки она отсчитывает с первого чтения.
 */
function readStored(): StoredTeacherJoinLink | null {
  const storage = safeStorage()
  const raw = storage?.getItem(STORAGE_KEY)
  if (!raw) return null

  let stored: StoredTeacherJoinLink | null = null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTeacherJoinLink>
    if (parsed && typeof parsed.token === 'string' && parsed.token) {
      stored = {
        token: parsed.token,
        savedAt: typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : Date.now(),
      }
    }
  } catch {
    // Не JSON — значит прежний формат: сама строка токена.
    stored = { token: raw, savedAt: Date.now() }
  }
  if (!stored) return null

  storage?.setItem(STORAGE_KEY, JSON.stringify(stored))
  return stored
}

export function readPendingTeacherJoinLink(): string | null {
  const stored = readStored()
  if (!stored) return null
  if (Date.now() - stored.savedAt > TEACHER_JOIN_LINK_MAX_AGE_MS) {
    clearPendingTeacherJoinLink()
    return null
  }
  return stored.token
}

export function clearPendingTeacherJoinLink(): void {
  const storage = safeStorage()
  if (!storage) return
  storage.removeItem(STORAGE_KEY)
}

export function hasPendingTeacherJoinLink(): boolean {
  return !!readPendingTeacherJoinLink()
}

/** Пустая роль — «ещё не знаем», а не «нельзя»: см. `inviteFitsRole`. */
export function teacherJoinLinkFitsRole(role?: string | null): boolean {
  return !role || role === 'student'
}

/**
 * Куда вести человека с висящей ссылкой преподавателя — или `null`.
 * При неподходящей роли запись вычищается: держать её значит оставлять
 * человеку ловушку на главной.
 */
export function getPendingTeacherJoinLinkPath(role?: string | null): string | null {
  const token = readPendingTeacherJoinLink()
  if (!token) return null
  if (!teacherJoinLinkFitsRole(role)) {
    clearPendingTeacherJoinLink()
    return null
  }
  return `/jt/${token}`
}
