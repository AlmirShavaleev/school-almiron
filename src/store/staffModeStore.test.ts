import { describe, expect, it, beforeEach } from 'vitest'
import {
  canSwitchStaffMode,
  effectiveRoleOf,
  isPreviewMode,
  useStaffModeStore,
} from '@/store/staffModeStore'

describe('staffModeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null })
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
    expect(localStorage.getItem('almiron:staff-mode:p1')).toBe('teacher')

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
    expect(localStorage.getItem('almiron:staff-mode:p1')).toBe('student')

    useStaffModeStore.setState({ mode: 'admin', profileId: null })
    useStaffModeStore.getState().hydrate('p1')
    expect(useStaffModeStore.getState().mode).toBe('student')
  })

  it('мусор в хранилище читается как admin', () => {
    localStorage.setItem('almiron:staff-mode:p1', 'root')
    useStaffModeStore.getState().hydrate('p1')
    expect(useStaffModeStore.getState().mode).toBe('admin')
  })
})
