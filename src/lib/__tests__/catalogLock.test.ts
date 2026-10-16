/**
 * §292. Закрытость раздела / задачи — ответ базы (`catalog_section_allowed`,
 * `catalog_tasks_allowed`); сбой = «открыто». Ошибка CATALOG_LOCKED узнаётся по
 * hint и по тексту.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { CATALOG_SUBSCRIBE_HREF, isCatalogLockedError, useSectionLocked, useTaskLocked } from '../catalogLock'

beforeEach(() => { rpc.mockReset() })

describe('§292: закрытость по ответу базы', () => {
  it('раздел: false от базы — закрыт; true — открыт; ошибка — открыт', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null })
    const a = renderHook(() => useSectionLocked('s1'))
    expect(a.result.current).toBeNull()
    await waitFor(() => expect(a.result.current).toBe(true))
    expect(rpc).toHaveBeenCalledWith('catalog_section_allowed', { p_section_id: 's1' })

    rpc.mockResolvedValueOnce({ data: true, error: null })
    const b = renderHook(() => useSectionLocked('s2'))
    await waitFor(() => expect(b.result.current).toBe(false))

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } })
    const c = renderHook(() => useSectionLocked('s3'))
    await waitFor(() => expect(c.result.current).toBe(false))
  })

  it('задача — catalog_tasks_allowed по одной задаче', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null })
    const h = renderHook(() => useTaskLocked('t1'))
    await waitFor(() => expect(h.result.current).toBe(true))
    expect(rpc).toHaveBeenCalledWith('catalog_tasks_allowed', { p_task_ids: ['t1'] })
  })

  it('ошибка CATALOG_LOCKED — по hint или по тексту; в main ссылки на подписку нет', () => {
    expect(isCatalogLockedError({ hint: 'CATALOG_LOCKED', message: 'x' })).toBe(true)
    expect(isCatalogLockedError({ message: 'Банк задач откроется с подпиской или пробным периодом' })).toBe(true)
    expect(isCatalogLockedError({ message: 'NOT_FOUND' })).toBe(false)
    expect(isCatalogLockedError(null)).toBe(false)
    expect(CATALOG_SUBSCRIBE_HREF).toBeNull()
  })
})
