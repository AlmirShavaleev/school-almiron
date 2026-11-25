import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { useCatalogOverview } from '@/hooks/useCatalogOverview'

const answer = {
  viewer: 'student', min_solvers: 10,
  overall: { solved: 3, solved_7d: 1, solvers: 4, better_pct: null },
  exams: [{ subject: 'Математика', exam_type: 'ЕГЭ', is_mine: true, total: 5, solved: 3, solved_7d: 1, solvers: 4, better_pct: null,
    numbers: [{ n: 1, total: 5, solved: 3, section_id: 's1' }] }],
}
const access = { data: ['Математика|ЕГЭ'], error: null }

describe('useCatalogOverview', () => {
  beforeEach(() => rpc.mockReset())

  it('показывает доступные направления до окончания загрузки статистики', async () => {
    let resolveOverview!: (value: { data: typeof answer; error: null }) => void
    rpc.mockResolvedValueOnce(access).mockReturnValueOnce(new Promise(resolve => { resolveOverview = resolve }))
    const { result } = renderHook(() => useCatalogOverview('u-1'))
    expect(result.current.directions).toEqual([])
    await waitFor(() => expect(result.current.directions).toEqual(access.data))
    expect(result.current.overview).toBeNull()
    expect(result.current.loading).toBe(true)
    expect(rpc).toHaveBeenNthCalledWith(1, 'catalog_subscription_directions', {})
    expect(rpc).toHaveBeenNthCalledWith(2, 'catalog_my_overview', {})
    act(() => resolveOverview({ data: answer, error: null }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.overview?.overall).toEqual({ solved: 3, solved7d: 1, solvers: 4, betterPct: null })
    expect(result.current.overview?.exams[0].numbers).toEqual([{ n: 1, total: 5, solved: 3, sectionId: 's1' }])
  })

  it('ошибка статистики оставляет доступные направления, «Повторить» перезапрашивает', async () => {
    rpc.mockResolvedValueOnce(access)
      .mockResolvedValueOnce({ data: null, error: { message: 'function public.catalog_my_overview() does not exist' } })
    const { result } = renderHook(() => useCatalogOverview('u-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.overview).toBeNull()
    expect(result.current.directions).toEqual(access.data)
    expect(result.current.error).toMatch(/does not exist/)

    rpc.mockResolvedValueOnce(access).mockResolvedValueOnce({ data: answer, error: null })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.overview).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(4)
  })

  it('без доступных направлений показывает замок и не запрашивает статистику', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    const { result } = renderHook(() => useCatalogOverview('u-1'))
    await waitFor(() => expect(result.current.locked).toBe(true))
    expect(result.current.directions).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('без пользователя ничего не запрашивает', async () => {
    const { result } = renderHook(() => useCatalogOverview(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(rpc).not.toHaveBeenCalled()
    expect(result.current.overview).toBeNull()
  })
})
