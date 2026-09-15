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
 *
 * Третий режим `student` (§178) — «глазами ученика»: предпросмотр
 * ученических экранов из аккаунта владельца. Правило то же: только
 * представление. Ученические страницы в этом режиме читают то, что персоналу
 * и так отдаёт RLS (программу, материалы, состав задач), а всё личное
 * (отметки, попытки, ответы) показывают пустым и НЕ пишут: каждая мутация
 * ученических хуков в предпросмотре — noop с тостом. Единственный источник
 * правды о том, что мы в предпросмотре, — `usePreviewMode()` ниже.
 */
export type StaffMode = 'admin' | 'teacher' | 'student'

/** Ярлык режима предпросмотра — в шапке и сайдбаре одинаково. */
export const PREVIEW_ROLE_LABEL = 'Ученик · предпросмотр'

/** Один текст на все выключенные кнопки и все noop-мутации предпросмотра. */
export const PREVIEW_NOOP_MESSAGE = 'В предпросмотре не сохраняется'

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
  if (mode === 'teacher') return 'teacher'
  if (mode === 'student') return 'student'
  return role
}

/**
 * Предпросмотр «глазами ученика» включён: настоящая роль admin/owner и режим
 * `student`. Для всех остальных — всегда false, что бы ни лежало в хранилище:
 * реальный ученик или преподаватель без права переключения предпросмотра не
 * получают.
 */
export function isPreviewMode(role: UserRole | null | undefined, mode: StaffMode): boolean {
  return canSwitchStaffMode(role) && mode === 'student'
}

/** Ключ на profile_id: на одной машине могут входить разные люди. */
const STORAGE_PREFIX = 'almiron:staff-mode:'

function readStoredMode(profileId: string): StaffMode {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + profileId)
    return raw === 'teacher' || raw === 'student' ? raw : 'admin'
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
 * Режим для ТЕКУЩЕГО рендера, ещё до того, как эффект `hydrate` доедет.
 *
 * Эффекты идут после коммита, а `RoleGuard` решает «пустить или увести» в
 * самом рендере. Если на первом рендере после появления профиля отдать
 * `mode` из стора (там ещё `admin` от предыдущего профиля или старта), сторож
 * ученического маршрута в предпросмотре отправит на `/dashboard`, и глубокая
 * ссылка на тему потеряется. Поэтому, пока стор не поднял режим этого
 * профиля, читаем сохранённый синхронно — тем же `readStoredMode`, что и
 * `hydrate`, второго правила нет.
 */
function useModeForProfile(profileId: string | null | undefined): StaffMode {
  const mode      = useStaffModeStore(s => s.mode)
  const storedFor = useStaffModeStore(s => s.profileId)
  const hydrate   = useStaffModeStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profileId ?? null)
  }, [profileId, hydrate])

  if (!profileId) return 'admin'
  return storedFor === profileId ? mode : readStoredMode(profileId)
}

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
  const mode    = useModeForProfile(profile?.id)

  // Предпросмотр ученика не сужает выборки персонала: хуки с ветками по
  // роли (`useGroups`, `useLessons`, …) живут на страницах персонала, и по
  // прямой ссылке в режиме `student` они обязаны показывать то же, что в
  // админском режиме, а не искать несуществующую строку `students`.
  // Ученическое представление решают `usePreviewMode()` и сами ученические
  // хуки — у них своя ветка «предпросмотр».
  if (isPreviewMode(profile?.role, mode)) return profile?.role ?? null
  return effectiveRoleOf(profile?.role ?? null, mode)
}

/**
 * Единственный источник правды «мы в предпросмотре глазами ученика».
 *
 * Ученические хуки и компоненты спрашивают только его: (а) хуки данных
 * ученика читают staff-источник или отдают пустое состояние и превращают
 * мутации в noop; (б) кнопки получают `disabled` с подсказкой. Ни один
 * вызов записи (`answer_topic_task`, `reveal_…`, `close_…`,
 * `topic_section_marks`, `topic_homework_*`, `topic_test_*`,
 * `record_material_view`) в этом режиме не уходит — это условие приёмки §178.
 */
export function usePreviewMode(): boolean {
  const profile = useAuthStore(s => s.profile)
  const mode    = useModeForProfile(profile?.id)
  return isPreviewMode(profile?.role, mode)
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
  const mode    = useModeForProfile(profile?.id)

  const role = profile?.role ?? null
  return canSwitchStaffMode(role) && mode === 'teacher'
}

/**
 * Единственная точка, из которой шапка и сайдбар берут режим и роль
 * представления.
 */
export function useStaffMode() {
  const profile    = useAuthStore(s => s.profile)
  const mode       = useModeForProfile(profile?.id)
  const choiceMade = useStaffModeStore(s => s.choiceMade)
  const setMode    = useStaffModeStore(s => s.setMode)
  const chooseMode = useStaffModeStore(s => s.chooseMode)

  const role      = profile?.role ?? null
  const canSwitch = canSwitchStaffMode(role)

  return {
    /** Сырое состояние переключателя. Для не-admin/owner смысла не имеет. */
    mode,
    setMode,
    chooseMode,
    canSwitch,
    /** Предпросмотр глазами ученика (§178). То же, что `usePreviewMode()`. */
    preview: isPreviewMode(role, mode),
    /**
     * Выход из предпросмотра — кнопка «Вернуться» на жёлтой полосе. Возвращает
     * в режим учителя: оттуда владелец в предпросмотр и попадает по смыслу
     * («как это выглядит у моих учеников»), а не из панели школы.
     */
    exitPreview: () => setMode('teacher'),
    /**
     * Показать ли экран выбора режима. Только тем, у кого две сущности, и
     * только пока выбор в этом входе не сделан.
     */
    needsModeChoice: canSwitch && !choiceMade,
    /** Роль, которой рисуется интерфейс. Никогда не используется для прав. */
    effectiveRole: effectiveRoleOf(role, mode),
  }
}
