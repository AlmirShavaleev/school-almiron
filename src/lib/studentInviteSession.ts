// Намерение «я пришёл по ссылке курса и хочу вступить». Хранится в
// localStorage, а НЕ в sessionStorage: ссылка подтверждения почты открывается в
// той вкладке, в которой человек кликнул письмо, — обычно в новой, а у неё своя
// пустая sessionStorage. Приглашение при этом молча исчезало, и человек
// оказывался зарегистрирован, но никуда не вступившим (наблюдалось на проде:
// профиль есть, групп ноль). Тот же вывод уже был сделан для преподавательской
// ссылки — см. комментарий в teacherJoinLinkSession; здесь его просто забыли
// применить ко второму контуру.
//
// Плата за долгую жизнь записи оказалась выше, чем предполагалось: у владельца
// на проде запись перехватила главную НАВСЕГДА. Он открывал `alminion.ru`,
// корень видел сохранённое приглашение и уводил на `/join/<token>`, где его
// встречало «приглашение предназначено для аккаунта ученика», — и так по кругу,
// в свой кабинет с главной было не попасть. Поэтому у записи теперь два предела:
//
//  1. СРОК. Приглашение живёт сутки. Дольше него не живёт ни один разумный
//     сценарий «перешёл по ссылке → зарегистрировался → подтвердил почту»;
//     всё, что старше, — это чужой или забытый след на общем компьютере.
//  2. АДРЕСАТ. Приглашение ученическое. Тому, у кого роль не ученическая,
//     оно не может пригодиться в принципе: вступить по нему нельзя, а
//     навигацию оно ломает. Такому человеку запись не просто игнорируется,
//     а вычищается — см. `getPendingInvitePath(role)`.
//
// Уборка после успешного вступления и на окончательных отказах (использовано /
// отозвано / истекло) остаётся на месте — сроки и роли её не заменяют.
const STORAGE_KEY = 'student-invite-pending'

/** Сутки. Дольше «я перешёл по ссылке и сейчас зарегистрируюсь» не длится. */
export const INVITE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type PendingInvite =
  | { type: 'token'; value: string }
  | { type: 'code'; value: string }

type StoredInvite = PendingInvite & { savedAt: number }

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
  const stored: StoredInvite = { ...invite, savedAt: Date.now() }
  storage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

function parseInvite(raw: string | null): StoredInvite | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredInvite>
    if (!parsed || (parsed.type !== 'token' && parsed.type !== 'code') || typeof parsed.value !== 'string') {
      return null
    }
    // Записи без отметки времени — те, что легли до этой правки. Считать их
    // просроченными нельзя: ровно в них сейчас лежит вступление людей,
    // которые уже нажали «зарегистрироваться» и ждут письма (ради этого случая
    // хранение и переезжало в localStorage). Поэтому им ставится отметка
    // «сейчас», и сутки они отсчитывают с первого чтения после деплоя.
    const savedAt = typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)
      ? parsed.savedAt
      : Date.now()
    return { type: parsed.type, value: parsed.value, savedAt }
  } catch {
    return null
  }
}

function readStoredInvite(): StoredInvite | null {
  const storage = safeStorage()
  const current = parseInvite(storage?.getItem(STORAGE_KEY) ?? null)
  if (current) {
    // Отметка могла быть только что проставлена при разборе — записываем её
    // обратно, иначе «сутки» отсчитывались бы заново при каждом чтении.
    storage?.setItem(STORAGE_KEY, JSON.stringify(current))
    return current
  }

  // Хвост прежнего хранения: переносим в localStorage и убираем из старого
  // места, чтобы одна и та же запись не жила в двух хранилищах.
  const legacy = safeLegacyStorage()
  const migrated = parseInvite(legacy?.getItem(STORAGE_KEY) ?? null)
  if (!migrated) return null
  legacy?.removeItem(STORAGE_KEY)
  storage?.setItem(STORAGE_KEY, JSON.stringify(migrated))
  return migrated
}

export function readPendingInvite(): PendingInvite | null {
  const stored = readStoredInvite()
  if (!stored) return null
  if (Date.now() - stored.savedAt > INVITE_MAX_AGE_MS) {
    // Просрочку убираем сразу, а не просто скрываем: иначе она осталась бы
    // лежать в чужом браузере и всплыла бы при следующей смене правил.
    clearPendingInvite()
    return null
  }
  return { type: stored.type, value: stored.value }
}

export function clearPendingInvite(): void {
  // Из обоих хранилищ: иначе перенесённая запись воскресла бы после уборки.
  safeStorage()?.removeItem(STORAGE_KEY)
  safeLegacyStorage()?.removeItem(STORAGE_KEY)
}

export function hasPendingInvite(): boolean {
  return !!readPendingInvite()
}

/**
 * Роль, которой ученическое приглашение может пригодиться.
 *
 * Пустая роль — это НЕ «нельзя»: у только что зарегистрировавшегося профиль
 * ещё едет, и именно ему приглашение нужнее всего. Отказываем только тогда,
 * когда роль известна и она не ученическая.
 */
export function inviteFitsRole(role?: string | null): boolean {
  return !role || role === 'student'
}

/**
 * Куда вести человека с висящим приглашением — или `null`, если вести некуда.
 *
 * `role` передаёт тот, кто знает роль вошедшего (корень приложения, форма
 * входа). Если роль не ученическая, приглашение здесь же вычищается: оно
 * бесполезно этому человеку и мешает ему ходить по приложению. Вызовы без
 * `role` (регистрация — там профиля ещё нет) работают как раньше.
 */
export function getPendingInvitePath(role?: string | null): string | null {
  const invite = readPendingInvite()
  if (!invite) return null
  if (!inviteFitsRole(role)) {
    clearPendingInvite()
    return null
  }
  if (invite.type === 'token') return `/join/${invite.value}`
  return '/join'
}
