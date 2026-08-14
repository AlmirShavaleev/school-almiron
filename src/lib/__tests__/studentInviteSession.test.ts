import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingInvite,
  getPendingInvitePath,
  hasPendingInvite,
  INVITE_MAX_AGE_MS,
  inviteFitsRole,
  readPendingInvite,
  savePendingInvite,
} from '@/lib/studentInviteSession'

const KEY = 'student-invite-pending'

/**
 * Приглашение ученика обязано пережить переход «регистрация → письмо →
 * подтверждение почты». Ссылка из письма открывается в той вкладке, где человек
 * кликнул, — обычно в новой, с пустой sessionStorage. Наблюдалось на проде:
 * профиль создан, а вступления нет вовсе.
 */
describe('studentInviteSession', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('переживает новую вкладку: запись живёт в localStorage, а не в sessionStorage', () => {
    savePendingInvite({ type: 'token', value: 'abc123' })

    expect(JSON.parse(localStorage.getItem(KEY) || '{}')).toMatchObject({ type: 'token', value: 'abc123' })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(getPendingInvitePath()).toBe('/join/abc123')
  })

  it('подхватывает запись из прежнего хранения и переносит её', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ type: 'code', value: 'ABCD1234' }))

    expect(readPendingInvite()).toEqual({ type: 'code', value: 'ABCD1234' })
    expect(JSON.parse(localStorage.getItem(KEY) || '{}')).toMatchObject({ type: 'code', value: 'ABCD1234' })
    // Из старого места запись убрана: две копии разъехались бы при уборке.
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('уборка вычищает оба хранилища — иначе чужое приглашение всплыло бы позже', () => {
    savePendingInvite({ type: 'token', value: 'abc123' })
    sessionStorage.setItem(KEY, JSON.stringify({ type: 'token', value: 'stale' }))

    clearPendingInvite()

    expect(hasPendingInvite()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('мусор в хранилище читается как «приглашения нет», а не роняет страницу', () => {
    localStorage.setItem(KEY, 'не json')
    expect(readPendingInvite()).toBeNull()

    localStorage.setItem(KEY, JSON.stringify({ type: 'что-то', value: 'x' }))
    expect(readPendingInvite()).toBeNull()
  })

  /**
   * Два предела, добавленные после продового случая у владельца: сохранённое
   * приглашение перехватывало ему главную навсегда — на `/join/<token>` его
   * встречало «предназначено для аккаунта ученика», и так по кругу.
   */
  describe('срок жизни', () => {
    it('через сутки с небольшим приглашение мертво и вычищено из хранилища', () => {
      savePendingInvite({ type: 'token', value: 'abc123' })
      const stale = { type: 'token', value: 'abc123', savedAt: Date.now() - INVITE_MAX_AGE_MS - 1000 }
      localStorage.setItem(KEY, JSON.stringify(stale))

      expect(readPendingInvite()).toBeNull()
      expect(getPendingInvitePath()).toBeNull()
      // Именно вычищено, а не просто скрыто от чтения.
      expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('в пределах суток приглашение живо', () => {
      const fresh = { type: 'token', value: 'abc123', savedAt: Date.now() - INVITE_MAX_AGE_MS + 60_000 }
      localStorage.setItem(KEY, JSON.stringify(fresh))

      expect(getPendingInvitePath()).toBe('/join/abc123')
    })

    it('запись без отметки времени не выбрасывается, а получает отметку «сейчас»', () => {
      // Такие записи лежат у людей, которые прямо сейчас ждут письмо
      // подтверждения. Счесть их просроченными значило бы заново сломать то,
      // ради чего хранение переезжало в localStorage (случай safsaida23).
      localStorage.setItem(KEY, JSON.stringify({ type: 'token', value: 'abc123' }))

      expect(getPendingInvitePath()).toBe('/join/abc123')
      const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
      expect(typeof stored.savedAt).toBe('number')
    })

    it('отметка не переставляется при каждом чтении — иначе срок никогда не наступит', () => {
      const savedAt = Date.now() - 12 * 60 * 60 * 1000
      localStorage.setItem(KEY, JSON.stringify({ type: 'token', value: 'abc123', savedAt }))

      readPendingInvite()
      readPendingInvite()

      expect(JSON.parse(localStorage.getItem(KEY) || '{}').savedAt).toBe(savedAt)
    })
  })

  describe('адресат', () => {
    it('персоналу приглашение не отдаётся и тут же вычищается', () => {
      for (const role of ['teacher', 'admin', 'owner', 'curator', 'parent']) {
        savePendingInvite({ type: 'token', value: 'abc123' })

        expect(getPendingInvitePath(role)).toBeNull()
        expect(localStorage.getItem(KEY)).toBeNull()
      }
    })

    it('ученику приглашение отдаётся', () => {
      savePendingInvite({ type: 'token', value: 'abc123' })
      expect(getPendingInvitePath('student')).toBe('/join/abc123')
      expect(localStorage.getItem(KEY)).not.toBeNull()
    })

    it('роль ещё не известна — приглашение цело: у новичка профиль едет позже', () => {
      savePendingInvite({ type: 'token', value: 'abc123' })

      expect(getPendingInvitePath(null)).toBe('/join/abc123')
      expect(getPendingInvitePath(undefined)).toBe('/join/abc123')
      expect(localStorage.getItem(KEY)).not.toBeNull()
    })

    it('inviteFitsRole: пустая роль это «ещё не знаем», а не «нельзя»', () => {
      expect(inviteFitsRole('student')).toBe(true)
      expect(inviteFitsRole(null)).toBe(true)
      expect(inviteFitsRole(undefined)).toBe(true)
      expect(inviteFitsRole('teacher')).toBe(false)
      expect(inviteFitsRole('owner')).toBe(false)
    })
  })
})
