import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §246. Хук главной каталога: один вызов catalog_my_overview, разбор ответа,
 * ошибка («функции нет» до миграции) не роняет страницу, «Повторить» —
 * перезапрос.
 */

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { useCatalogOverview } from '@/hooks/useCatalogOverview'

const answer = {
  viewer: 'student', min_solvers: 10,
  overall: { solved: 3, solved_7d: 1, solvers: 4, better_pct: null },
  exams: [{ subject: 'Математика', exam_type: 'ЕГЭ', is_mine: true, total: 5, solved: 3, solved_7d: 1, solvers: 4, better_pct: null,
    numbers: [{ n: 1, total: 5, solved: 3, section_id: 's1' }] }],
}

describe('useCatalogOverview', () => {
  beforeEach(() => rpc.mockReset())

  it('зовёт catalog_my_overview и отдаёт разобранный ответ', async () => {
    rpc.mockResolvedValue({ data: answer, error: null })
    const { result } = renderHook(() => useCatalogOverview('u-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(rpc).toHaveBeenCalledWith('catalog_my_overview', {})
    expect(result.current.error).toBeNull()
    expect(result.current.overview?.overall).toEqual({ solved: 3, solved7d: 1, solvers: 4, betterPct: null })
    expect(result.current.overview?.exams[0].numbers).toEqual([{ n: 1, total: 5, solved: 3, sectionId: 's1' }])
  })

  it('ошибка функции — overview null и текст ошибки; «Повторить» перезапрашивает', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function public.catalog_my_overview() does not exist' } })
    const { result } = renderHook(() => useCatalogOverview('u-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.overview).toBeNull()
    expect(result.current.error).toMatch(/does not exist/)

    rpc.mockResolvedValueOnce({ data: answer, error: null })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.overview).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('без пользователя ничего не запрашивает', async () => {
    const { result } = renderHook(() => useCatalogOverview(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(rpc).not.toHaveBeenCalled()
    expect(result.current.overview).toBeNull()
  })
})
