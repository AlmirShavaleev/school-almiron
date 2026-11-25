/**
 * §292. Закрытость задачи определяется ответом `catalog_tasks_allowed`.
 * Ошибка CATALOG_LOCKED узнаётся по hint и по тексту.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { CATALOG_SUBSCRIBE_HREF, isCatalogLockedError, useTaskLocked } from '../catalogLock'

beforeEach(() => { rpc.mockReset() })

describe('§292: закрытость по ответу базы', () => {
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
