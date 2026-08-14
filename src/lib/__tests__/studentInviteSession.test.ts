import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingInvite,
  getPendingInvitePath,
  hasPendingInvite,
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

    expect(JSON.parse(localStorage.getItem(KEY) || '{}')).toEqual({ type: 'token', value: 'abc123' })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(getPendingInvitePath()).toBe('/join/abc123')
  })

  it('подхватывает запись из прежнего хранения и переносит её', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ type: 'code', value: 'ABCD1234' }))

    expect(readPendingInvite()).toEqual({ type: 'code', value: 'ABCD1234' })
    expect(JSON.parse(localStorage.getItem(KEY) || '{}')).toEqual({ type: 'code', value: 'ABCD1234' })
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
})
