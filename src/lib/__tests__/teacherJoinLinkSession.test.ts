import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingTeacherJoinLink,
  getPendingTeacherJoinLinkPath,
  hasPendingTeacherJoinLink,
  readPendingTeacherJoinLink,
  savePendingTeacherJoinLink,
  TEACHER_JOIN_LINK_MAX_AGE_MS,
} from '@/lib/teacherJoinLinkSession'

const KEY = 'teacher-join-link-pending'

/**
 * Ссылка преподавателя хранится в localStorage по той же причине, что и
 * ученическое приглашение: письмо подтверждения открывается в новой вкладке с
 * пустой sessionStorage. И по той же причине у неё теперь два предела — сутки
 * жизни и подходящая роль: вечная запись перехватывала владельцу главную
 * (разбор в studentInviteSession).
 */
describe('teacherJoinLinkSession', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('сохраняется и читается', () => {
    savePendingTeacherJoinLink('tok-1')

    expect(readPendingTeacherJoinLink()).toBe('tok-1')
    expect(getPendingTeacherJoinLinkPath()).toBe('/jt/tok-1')
    expect(hasPendingTeacherJoinLink()).toBe(true)
  })

  it('прежний формат — голая строка токена — не теряется', () => {
    // Так запись лежит у людей, начавших путь до этой правки. Потерять её
    // значило бы заново сломать вступление, которое чинил переезд в localStorage.
    localStorage.setItem(KEY, 'tok-legacy')

    expect(readPendingTeacherJoinLink()).toBe('tok-legacy')
    // При чтении переписана в новый формат с отметкой времени.
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    expect(stored.token).toBe('tok-legacy')
    expect(typeof stored.savedAt).toBe('number')
  })

  it('через сутки ссылка мертва и вычищена', () => {
    localStorage.setItem(KEY, JSON.stringify({
      token: 'tok-1',
      savedAt: Date.now() - TEACHER_JOIN_LINK_MAX_AGE_MS - 1000,
    }))

    expect(readPendingTeacherJoinLink()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('в пределах суток ссылка жива', () => {
    localStorage.setItem(KEY, JSON.stringify({
      token: 'tok-1',
      savedAt: Date.now() - TEACHER_JOIN_LINK_MAX_AGE_MS + 60_000,
    }))

    expect(getPendingTeacherJoinLinkPath()).toBe('/jt/tok-1')
  })

  it('отметка времени не переставляется при каждом чтении', () => {
    const savedAt = Date.now() - 12 * 60 * 60 * 1000
    localStorage.setItem(KEY, JSON.stringify({ token: 'tok-1', savedAt }))

    readPendingTeacherJoinLink()
    readPendingTeacherJoinLink()

    expect(JSON.parse(localStorage.getItem(KEY) || '{}').savedAt).toBe(savedAt)
  })

  it('персоналу ссылка не отдаётся и вычищается, ученику отдаётся', () => {
    savePendingTeacherJoinLink('tok-1')
    expect(getPendingTeacherJoinLinkPath('teacher')).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()

    savePendingTeacherJoinLink('tok-2')
    expect(getPendingTeacherJoinLinkPath('student')).toBe('/jt/tok-2')
    expect(getPendingTeacherJoinLinkPath(null)).toBe('/jt/tok-2')
  })

  it('уборка снимает запись', () => {
    savePendingTeacherJoinLink('tok-1')
    clearPendingTeacherJoinLink()

    expect(hasPendingTeacherJoinLink()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
