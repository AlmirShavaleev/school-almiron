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

/**
 * Отметка «в этом входе режим уже выбран» — экран выбора спрашивает при каждом
 * входе, но не при каждой перезагрузке страницы.
 *
 * Почему sessionStorage, а не localStorage и не память:
 * - localStorage пережил бы выход и вход, и экран не показался бы никогда;
 * - память в сторе сбрасывается на F5, и экран лез бы при каждом обновлении.
 * sessionStorage живёт ровно столько, сколько вкладка, и чистится при выходе
 * (`clearStaffModeChoice` зовёт signOut). Отдельный ключ от самого режима:
 * режим — долгая настройка, отметка — про текущий вход.
 */
const CHOICE_PREFIX = 'almiron:staff-mode-chosen:'

function readChoiceMade(profileId: string): boolean {
  try {
    return sessionStorage.getItem(CHOICE_PREFIX + profileId) === '1'
  } catch {
    // Хранилище недоступно — считаем, что не выбирали. Экран покажется лишний
    // раз, это безопаснее молчаливого пропуска.
    return false
  }
}

function writeChoiceMade(profileId: string): void {
  try {
    sessionStorage.setItem(CHOICE_PREFIX + profileId, '1')
  } catch {
    /* см. readChoiceMade */
  }
}

/** Зовётся при выходе: следующий вход снова спросит режим. */
export function clearStaffModeChoice(profileId: string | null | undefined): void {
  try {
    if (profileId) sessionStorage.removeItem(CHOICE_PREFIX + profileId)
  } catch {
    /* см. readChoiceMade */
  }
}

interface StaffModeState {
  mode:       StaffMode
  profileId:  string | null
  /** Выбран ли режим в текущем входе. Для не-admin/owner смысла не имеет. */
  choiceMade: boolean
  setMode:    (mode: StaffMode) => void
  /** Выбор на входном экране: ставит режим И закрывает экран до конца входа. */
  chooseMode: (mode: StaffMode) => void
  /** Подхватить сохранённый режим при появлении/смене профиля. */
  hydrate:    (profileId: string | null) => void
}

export const useStaffModeStore = create<StaffModeState>()((set, get) => ({
  mode:       'admin',
  profileId:  null,
  choiceMade: false,
  setMode: (mode) => {
    const { profileId } = get()
    if (profileId) writeStoredMode(profileId, mode)
    set({ mode })
  },
  chooseMode: (mode) => {
    const { profileId } = get()
    if (profileId) {
      writeStoredMode(profileId, mode)
      writeChoiceMade(profileId)
    }
    set({ mode, choiceMade: true })
  },
  hydrate: (profileId) => {
    if (get().profileId === profileId) return
    set({
      profileId,
      mode:       profileId ? readStoredMode(profileId) : 'admin',
      choiceMade: profileId ? readChoiceMade(profileId) : false,
    })
  },
}))

/**
 * Роль, которой СЕЙЧАС работают, — для выборок данных.
 *
 * Зачем отдельно от `useStaffMode`: страницам и хукам не нужен весь набор
 * (переключатель, экран выбора), им нужен один ответ на вопрос «сужать ли
 * выдачу до своего». Владелец в режиме учителя должен видеть свои курсы и
 * своих учеников, а не всю школу, — а под админской RLS база отдаёт ему всё,
 * поэтому сужение обязано стоять в запросе клиента.
 *
 * ⚠️ Это НЕ проверка прав. Права проверяют RLS и `RoleGuard` по настоящей роли
 * из профиля; здесь решается только объём выдачи. Подставлять это значение в
 * условия доступа нельзя — режим переключается кнопкой в шапке.
 */
export function useEffectiveRole(): UserRole | null {
  const profile = useAuthStore(s => s.profile)
  const mode    = useStaffModeStore(s => s.mode)
  const hydrate = useStaffModeStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profile?.id ?? null)
  }, [profile?.id, hydrate])

  return effectiveRoleOf(profile?.role ?? null, mode)
}

/**
 * true, когда выдачу обязан сузить КЛИЕНТ.
 *
 * У настоящего учителя данные сужает RLS: `courses_select_scoped`,
 * `course_is_staff` и соседи отдают только своё. У admin/owner RLS не сужает
 * НИЧЕГО — политики построены на `is_admin_or_owner()`, и в режиме учителя
 * такой человек видит всю школу. Разница и есть ответ на вопрос «фильтровать
 * ли руками»: фильтруем ровно тогда, когда роль представления учительская, а
 * настоящая — нет.
 *
 * Почему не фильтровать всегда, когда режим учительский: настоящий учитель
 * может быть куратором курса (`course_curators`) или куратором группы — RLS
 * такие курсы ему отдаёт, а наивный клиентский фильтр «только мои группы» их
 * бы отнял. Сужать поверх правильной RLS — это ломать, а не чинить.
 */
export function useNeedsOwnDataFilter(): boolean {
  const profile = useAuthStore(s => s.profile)
  const mode    = useStaffModeStore(s => s.mode)
  const hydrate = useStaffModeStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profile?.id ?? null)
  }, [profile?.id, hydrate])

  const role = profile?.role ?? null
  return canSwitchStaffMode(role) && mode === 'teacher'
}

/**
 * Единственная точка, из которой шапка и сайдбар берут режим и роль
 * представления.
 */
export function useStaffMode() {
  const profile    = useAuthStore(s => s.profile)
  const mode       = useStaffModeStore(s => s.mode)
  const choiceMade = useStaffModeStore(s => s.choiceMade)
  const setMode    = useStaffModeStore(s => s.setMode)
  const chooseMode = useStaffModeStore(s => s.chooseMode)
  const hydrate    = useStaffModeStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profile?.id ?? null)
  }, [profile?.id, hydrate])

  const role      = profile?.role ?? null
  const canSwitch = canSwitchStaffMode(role)

  return {
    /** Сырое состояние переключателя. Для не-admin/owner смысла не имеет. */
    mode,
    setMode,
    chooseMode,
    canSwitch,
    /**
     * Показать ли экран выбора режима. Только тем, у кого две сущности, и
     * только пока выбор в этом входе не сделан.
     */
    needsModeChoice: canSwitch && !choiceMade,
    /** Роль, которой рисуется интерфейс. Никогда не используется для прав. */
    effectiveRole: effectiveRoleOf(role, mode),
  }
}
