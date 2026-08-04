import { create } from 'zustand'
import { useEffect } from 'react'
import type { UserRole } from '@/types'
import { useAuthStore } from '@/store/authStore'

/**
 * Режим представления для владельца, который одновременно админ и учитель.
 *
 * ⚠️ Это ЧИСТОЕ ПРЕДСТАВЛЕНИЕ. Режим решает ровно три вещи: ярлык роли в
 * шапке и сайдбаре, набор пунктов меню и куда ведёт `/dashboard`. Он НЕ
 * подменяет роль в данных, НЕ трогает auth и НЕ участвует ни в одной
 * проверке прав: `RoleGuard`, RLS и `get_my_role()` всегда видят настоящую
 * роль из профиля. Это не impersonation — вход под чужим аккаунтом живёт
 * отдельно (`components/demo/ImpersonationBanner`).
 *
 * Следствие, которое так и задумано: админские маршруты остаются доступными
 * по прямой ссылке и в режиме учителя. Меню — удобство, безопасность держит
 * база.
 */
export type StaffMode = 'admin' | 'teacher'

/**
 * Ярлыки ролей — ЕДИНСТВЕННАЯ копия на приложение.
 *
 * Их было две: `ROLE_LABELS` в `DashboardLayout` и `getRoleLabel` в
 * `Sidebar`, и они уже разошлись (учитель звался «Учитель» в шапке и
 * «Преподаватель» в меню). Переключатель обязан кормить обе поверхности из
 * одного места: иначе одно и то же состояние подписано двумя разными
 * словами. Новых копий не заводить.
 */
export const ROLE_LABELS: Record<string, string> = {
  student: 'Ученик',
  teacher: 'Преподаватель',
  curator: 'Куратор',
  admin:   'Администратор',
  owner:   'Владелец',
}

/** Переключатель видят только те, у кого есть вторая сущность. */
export function canSwitchStaffMode(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'owner'
}

/**
 * Роль, которой рисуется интерфейс. Для всех, кроме admin/owner, — это их
 * собственная роль, и переключатель на них не влияет вовсе.
 */
export function effectiveRoleOf(role: UserRole | null | undefined, mode: StaffMode): UserRole | null {
  if (!role) return null
  if (!canSwitchStaffMode(role)) return role
  return mode === 'teacher' ? 'teacher' : role
}

/** Ключ на profile_id: на одной машине могут входить разные люди. */
const STORAGE_PREFIX = 'almiron:staff-mode:'

function readStoredMode(profileId: string): StaffMode {
  try {
    return localStorage.getItem(STORAGE_PREFIX + profileId) === 'teacher' ? 'teacher' : 'admin'
  } catch {
    // localStorage недоступен (приватный режим, запрет хранилища) — режим
    // просто не переживёт перезагрузку, ломаться тут нечему.
    return 'admin'
  }
}

function writeStoredMode(profileId: string, mode: StaffMode): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + profileId, mode)
  } catch {
    /* см. readStoredMode */
  }
}

interface StaffModeState {
  mode:      StaffMode
  profileId: string | null
  setMode:   (mode: StaffMode) => void
  /** Подхватить сохранённый режим при появлении/смене профиля. */
  hydrate:   (profileId: string | null) => void
}

export const useStaffModeStore = create<StaffModeState>()((set, get) => ({
  mode:      'admin',
  profileId: null,
  setMode: (mode) => {
    const { profileId } = get()
    if (profileId) writeStoredMode(profileId, mode)
    set({ mode })
  },
  hydrate: (profileId) => {
    if (get().profileId === profileId) return
    set({
      profileId,
      mode: profileId ? readStoredMode(profileId) : 'admin',
    })
  },
}))

/**
 * Единственная точка, из которой шапка и сайдбар берут режим и роль
 * представления.
 */
export function useStaffMode() {
  const profile = useAuthStore(s => s.profile)
  const mode    = useStaffModeStore(s => s.mode)
  const setMode = useStaffModeStore(s => s.setMode)
  const hydrate = useStaffModeStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profile?.id ?? null)
  }, [profile?.id, hydrate])

  const role      = profile?.role ?? null
  const canSwitch = canSwitchStaffMode(role)

  return {
    /** Сырое состояние переключателя. Для не-admin/owner смысла не имеет. */
    mode,
    setMode,
    canSwitch,
    /** Роль, которой рисуется интерфейс. Никогда не используется для прав. */
    effectiveRole: effectiveRoleOf(role, mode),
  }
}
