import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

/**
 * AppAuth calls loadProfile() on every onAuthStateChange event, including
 * periodic TOKEN_REFRESHED events that carry the same profile row. Before the
 * fix, that meant a brand-new object reference on every refresh, which
 * ripples into every consumer with `profile` (not `profile?.id`) in a deps
 * array — see useHomeworkQueue / CreateMockExamModal. AppAuth must now skip
 * setProfile when the fetched row is field-for-field identical to what's
 * already in the store.
 */

type MockResult = { data: unknown; error: { message: string } | null }

function makeChain(result: MockResult) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

let profileRow: Record<string, unknown> = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'teacher' }
let profileMissing = false
const insertSpy = vi.fn()

const fromSpy = vi.fn((table: string) => {
  if (table === 'profiles') {
    const chain: any = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          const result = profileMissing ? { data: null, error: null } : { data: { ...profileRow }, error: null }
          const p = Promise.resolve(result)
          return p.then.bind(p)
        }
        if (prop === 'insert') return (...args: unknown[]) => { insertSpy(...args); return chain }
        return () => chain
      },
    })
    return chain
  }
  return makeChain({ data: null, error: null })
})

/**
 * `record_app_visit` (§78) — отметка «человек заходил сегодня» для дашборда
 * школы. AppAuth зовёт её после каждой удачной загрузки профиля, поэтому мок
 * обязан знать `rpc`: без него весь файл падал с «supabase.rpc is not a
 * function» на App.tsx. Ошибку вызова App глотает намеренно — счётчик
 * активности не должен ломать вход, — поэтому мок отвечает успехом.
 */
const rpcSpy = vi.fn((_fn: string) => Promise.resolve({ data: null, error: null }))

let authCallback: ((event: string, session: unknown) => void | Promise<void>) | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
    rpc: (fn: string) => rpcSpy(fn),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void | Promise<void>) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  },
}))

import { AppAuth } from '@/App'
import { useAuthStore } from '@/store/authStore'

const sessionUser = { user: { id: 'u1', email: 'a@a.com' } }

async function fireAuthEvent() {
  await act(async () => {
    await authCallback!('TOKEN_REFRESHED', sessionUser)
    await Promise.resolve()
  })
}

describe('AppAuth — skips setProfile on a content-identical profile row', () => {
  beforeEach(() => {
    fromSpy.mockClear()
    insertSpy.mockClear()
    rpcSpy.mockClear()
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'teacher' }
    profileMissing = false
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    authCallback = null
    sessionStorage.clear()
  })

  it('sets the profile once on the first event, then ignores N same-data TOKEN_REFRESHED events', async () => {
    render(<AppAuth />)

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    await fireAuthEvent() // first: null -> row, must set
    expect(setProfileCalls).toBe(1)
    expect(useAuthStore.getState().profile).toEqual(profileRow)

    for (let i = 0; i < 10; i++) await fireAuthEvent() // same row every time
    expect(setProfileCalls).toBe(1)

    unsub()
  })

  it('does set the profile when the role actually changes', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, role: 'admin' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    expect(useAuthStore.getState().profile).toEqual(profileRow)
    unsub()
  })

  it('does set the profile when full_name changes', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, full_name: 'Anna' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    unsub()
  })

  it('detects a brand-new column that appears on the row (no hardcoded field list)', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, avatar_url: 'https://example.com/a.png' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    unsub()
  })

  // Раньше вставка профиля пропускалась, пока в sessionStorage висит
  // приглашение (расчёт на то, что легаси-RPC создаст профиль сама и подставит
  // ФИО из приглашения). Курсовым ссылкам это ломало вступление насмерть:
  // course_join_accept читает роль из profiles, получает NULL и отвечает «По
  // этой ссылке присоединяются только ученики». Профиль обязан появиться сразу,
  // как только есть сессия, — RLS позволяет вставить его только здесь.
  it('создаёт профиль student даже при висящем приглашении (иначе course_join_accept отказывает)', async () => {
    profileMissing = true
    sessionStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))

    render(<AppAuth />)
    await fireAuthEvent()

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ id: 'u1', email: 'a@a.com', role: 'student' })
  })

  // full_name в profiles — NOT NULL, а в invite-режиме ФИО не спрашивают:
  // пустая строка засоряла бы журнал преподавателя безымянными учениками.
  it('подставляет непустое full_name, если ФИО при регистрации не вводили', async () => {
    profileMissing = true

    render(<AppAuth />)
    await fireAuthEvent()

    expect(insertSpy.mock.calls[0][0].full_name).toBe('a')
  })

  it('не вставляет профиль, если он уже есть', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    expect(insertSpy).not.toHaveBeenCalled()
  })

  // Мок теперь молча принимает любой rpc — без этой проверки пропажа отметки
  // визита прошла бы незамеченной, и дашборд школы тихо показывал бы нули.
  it('отмечает визит после загрузки профиля', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    expect(rpcSpy).toHaveBeenCalledWith('record_app_visit')
  })

  // profileMissing оставляет строку ненайденной и после вставки — это путь
  // «профиля так и нет». Визит по такому входу не отмечается: в app_visits
  // ключ на profiles, и запись всё равно упёрлась бы в FK.
  it('не отмечает визит, когда профиля нет', async () => {
    profileMissing = true

    render(<AppAuth />)
    await fireAuthEvent()

    expect(rpcSpy).not.toHaveBeenCalledWith('record_app_visit')
  })
})
