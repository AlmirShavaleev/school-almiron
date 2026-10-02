import { describe, expect, it, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useToastStore } from '@/store/toastStore'
import { useAchievementsBadge } from '@/store/achievementsStore'
import { syncResponse } from '@/test/achievementsFixture'

/**
 * §257. `useAchievements`: тост новой награды ровно один раз (даже в
 * StrictMode, где первый эффект «отменяется»), счётчик меню, claim прогноза.
 */
const state = { syncCalls: 0, inserted: false, claimFresh: [] as string[], calls: [] as Array<[string, unknown]> }
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      state.calls.push([fn, args])
      if (fn === 'student_achievements_sync') {
        state.syncCalls++
        // Как база: первый вызов вставляет (fresh), следующие — уже нет.
        const fresh = state.inserted ? [] : ['hw:5']
        state.inserted = true
        return Promise.resolve({ data: syncResponse({ have: { hw: 5 }, fresh, isNew: ['hw:5'] }), error: null })
      }
      if (fn === 'claim_forecast_achievement') return Promise.resolve({ data: { fresh: state.claimFresh }, error: null })
      return Promise.resolve({ data: null, error: { message: 'нет функции' } })
    },
  },
}))

import { useAchievements } from '@/hooks/useAchievements'

const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }) }

beforeEach(() => {
  state.syncCalls = 0; state.inserted = false; state.claimFresh = []; state.calls = []
  useToastStore.setState({ toasts: [] })
  useAchievementsBadge.setState({ newCount: null })
})

describe('useAchievements', () => {
  it('StrictMode (эффект дважды): тост «Новая награда: 5 ДЗ · +10» — один', async () => {
    const onFresh = vi.fn()
    const { result } = renderHook(() => useAchievements('p1', { onFresh }), { wrapper: StrictMode })
    await flush()
    expect(state.syncCalls).toBeGreaterThanOrEqual(1)
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Новая награда: 5 ДЗ · +10'])
    expect(onFresh).toHaveBeenCalledTimes(1)
    expect(result.current.data?.earned).toBe(2)
    // главная (без markSeen) сообщает меню число новых
    expect(useAchievementsBadge.getState().newCount).toBe(1)
  })

  it('claim без новых значков — список не перечитывается; с новыми — перечитывается и тост', async () => {
    const { result } = renderHook(() => useAchievements('p1'))
    await flush()
    useToastStore.setState({ toasts: [] })
    const before = state.syncCalls
    await act(async () => { await result.current.claimForecast('math', 40, 44) })
    await flush()
    expect(state.syncCalls).toBe(before)
    state.claimFresh = ['forecast:5']
    await act(async () => { await result.current.claimForecast('math', 40, 46) })
    await flush()
    expect(state.syncCalls).toBe(before + 1)
    expect(state.calls.find(([fn]) => fn === 'claim_forecast_achievement')![1]).toEqual({ p_subject: 'math', p_first_score: 40, p_current_score: 44 })
    expect(useToastStore.getState().toasts.map(t => t.message)).toEqual(['Новая награда: Прогноз +5'])
  })

  it('без профиля — база не спрашивается', async () => {
    renderHook(() => useAchievements(null))
    await flush()
    expect(state.syncCalls).toBe(0)
  })
})
