import { describe, expect, it, beforeEach } from 'vitest'
import {
  canSwitchStaffMode,
  effectiveRoleOf,
  isInsideMobilePreview,
  isPreviewMode,
  useStaffModeStore,
  type WindowLike,
} from '@/store/staffModeStore'

/** Что лежит под ключом профиля: с §181 это JSON `{ mode, mobilePreview }`. */
function stored(profileId: string): { mode?: string; mobilePreview?: boolean } | null {
  const raw = localStorage.getItem('almiron:staff-mode:' + profileId)
  return raw === null ? null : JSON.parse(raw)
}

describe('staffModeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', mobilePreview: false, profileId: null })
  })

  it('переключатель есть только у admin и owner', () => {
    expect(canSwitchStaffMode('admin')).toBe(true)
    expect(canSwitchStaffMode('owner')).toBe(true)
    expect(canSwitchStaffMode('teacher')).toBe(false)
    expect(canSwitchStaffMode('curator')).toBe(false)
    expect(canSwitchStaffMode('student')).toBe(false)
    expect(canSwitchStaffMode(null)).toBe(false)
  })

  it('режим учителя меняет роль представления, режим админа — нет', () => {
    expect(effectiveRoleOf('admin', 'teacher')).toBe('teacher')
    expect(effectiveRoleOf('admin', 'admin')).toBe('admin')
    expect(effectiveRoleOf('owner', 'teacher')).toBe('teacher')
    expect(effectiveRoleOf('owner', 'admin')).toBe('owner')
  })

  it('на чужие роли режим не влияет вовсе', () => {
    expect(effectiveRoleOf('student', 'teacher')).toBe('student')
    expect(effectiveRoleOf('curator', 'teacher')).toBe('curator')
    expect(effectiveRoleOf('teacher', 'admin')).toBe('teacher')
  })

  it('режим переживает перезагрузку и хранится на profile_id', () => {
    useStaffModeStore.getState().hydrate('p1')
    useStaffModeStore.getState().setMode('teacher')
    expect(stored('p1')?.mode).toBe('teacher')

    // «перезагрузка»: новый чистый стор поднимает сохранённое
    useStaffModeStore.setState({ mode: 'admin', profileId: null })
    useStaffModeStore.getState().hydrate('p1')
    expect(useStaffModeStore.getState().mode).toBe('teacher')

    // другой профиль на той же машине начинает с админа
    useStaffModeStore.getState().hydrate('p2')
    expect(useStaffModeStore.getState().mode).toBe('admin')
  })

  it('до входа режим не пишется в хранилище', () => {
    useStaffModeStore.getState().setMode('teacher')
    expect(localStorage.length).toBe(0)
  })

  // §178: третий режим — предпросмотр глазами ученика.
  it('режим ученика — роль представления student только у admin/owner', () => {
    expect(effectiveRoleOf('admin', 'student')).toBe('student')
    expect(effectiveRoleOf('owner', 'student')).toBe('student')
    expect(effectiveRoleOf('teacher', 'student')).toBe('teacher')
    expect(effectiveRoleOf('student', 'student')).toBe('student')
    expect(effectiveRoleOf('curator', 'student')).toBe('curator')
  })

  it('предпросмотр включён только у admin/owner в режиме student', () => {
    expect(isPreviewMode('admin', 'student')).toBe(true)
    expect(isPreviewMode('owner', 'student')).toBe(true)
    expect(isPreviewMode('admin', 'teacher')).toBe(false)
    expect(isPreviewMode('owner', 'admin')).toBe(false)
    // Реальный ученик и преподаватель предпросмотра не получают, что бы ни
    // лежало в хранилище.
    expect(isPreviewMode('teacher', 'student')).toBe(false)
    expect(isPreviewMode('student', 'student')).toBe(false)
    expect(isPreviewMode('curator', 'student')).toBe(false)
    expect(isPreviewMode(null, 'student')).toBe(false)
  })

  it('режим ученика хранится тем же ключом и переживает перезагрузку', () => {
    useStaffModeStore.getState().hydrate('p1')
    useStaffModeStore.getState().setMode('student')
    expect(stored('p1')?.mode).toBe('student')

    useStaffModeStore.setState({ mode: 'admin', profileId: null })
    useStaffModeStore.getState().hydrate('p1')
    expect(useStaffModeStore.getState().mode).toBe('student')
  })

  it('мусор в хранилище читается как admin', () => {
    localStorage.setItem('almiron:staff-mode:p1', 'root')
    useStaffModeStore.getState().hydrate('p1')
    expect(useStaffModeStore.getState().mode).toBe('admin')
  })

  // §181: «Мобильный вид» — переключатель поверх режимов, тот же ключ.
  describe('мобильный вид (§181)', () => {
    it('старое строковое значение читается как режим без «телефона»', () => {
      localStorage.setItem('almiron:staff-mode:p1', 'teacher')
      useStaffModeStore.getState().hydrate('p1')
      expect(useStaffModeStore.getState().mode).toBe('teacher')
      expect(useStaffModeStore.getState().mobilePreview).toBe(false)
    })

    it('«телефон» хранится тем же ключом вместе с режимом и переживает перезагрузку', () => {
      useStaffModeStore.getState().hydrate('p1')
      useStaffModeStore.getState().setMode('student')
      useStaffModeStore.getState().setMobilePreview(true)
      expect(stored('p1')).toEqual({ mode: 'student', mobilePreview: true })
      // Режим при этом не изменился — «телефон» ортогонален.
      expect(useStaffModeStore.getState().mode).toBe('student')

      useStaffModeStore.setState({ mode: 'admin', mobilePreview: false, profileId: null })
      useStaffModeStore.getState().hydrate('p1')
      expect(useStaffModeStore.getState().mode).toBe('student')
      expect(useStaffModeStore.getState().mobilePreview).toBe(true)

      // Смена режима не сбрасывает «телефон», выключение «телефона» — режим.
      useStaffModeStore.getState().setMode('teacher')
      expect(stored('p1')).toEqual({ mode: 'teacher', mobilePreview: true })
      useStaffModeStore.getState().setMobilePreview(false)
      expect(stored('p1')).toEqual({ mode: 'teacher', mobilePreview: false })
    })

    it('битый JSON и чужие значения читаются как admin без «телефона»', () => {
      localStorage.setItem('almiron:staff-mode:p1', '{"mode":"root","mobilePreview":"yes"')
      useStaffModeStore.getState().hydrate('p1')
      expect(useStaffModeStore.getState().mode).toBe('admin')
      expect(useStaffModeStore.getState().mobilePreview).toBe(false)

      useStaffModeStore.setState({ mode: 'admin', mobilePreview: false, profileId: null })
      localStorage.setItem('almiron:staff-mode:p1', '{"mode":"root","mobilePreview":"yes"}')
      useStaffModeStore.getState().hydrate('p1')
      expect(useStaffModeStore.getState().mode).toBe('admin')
      expect(useStaffModeStore.getState().mobilePreview).toBe(false)
    })

    it('до входа «телефон» не пишется в хранилище', () => {
      useStaffModeStore.getState().setMobilePreview(true)
      expect(localStorage.length).toBe(0)
    })

    it('isInsideMobilePreview: только вложенное окно с признаком от родителя', () => {
      const win = (over: Partial<WindowLike>): WindowLike => {
        const self = {}
        return { self, top: self, name: '', location: { search: '' }, ...over }
      }
      // Верхнее окно — никогда, даже с параметром в адресе.
      expect(isInsideMobilePreview(win({}))).toBe(false)
      expect(isInsideMobilePreview(win({ location: { search: '?mobile-preview=1' } }))).toBe(false)
      // Вложенное окно без признака — чужое встраивание, не наш «телефон».
      expect(isInsideMobilePreview(win({ top: {} }))).toBe(false)
      expect(isInsideMobilePreview(win({ top: {}, location: { search: '?mobile-preview=0' } }))).toBe(false)
      // Вложенное с параметром на первой загрузке…
      expect(isInsideMobilePreview(win({ top: {}, location: { search: '?tab=2&mobile-preview=1' } }))).toBe(true)
      // …и по имени окна после навигации внутри, когда параметр уже потерян.
      expect(isInsideMobilePreview(win({ top: {}, name: 'mobile-preview' }))).toBe(true)
      expect(isInsideMobilePreview(undefined)).toBe(false)
    })
  })
})
