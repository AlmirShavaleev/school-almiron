/**
 * §241. Данные раздела: ответ RPC → `ready`; ошибка (миграция не применена,
 * сбой) → `error`, по которому экран рисует прежний блок; в предпросмотре
 * персонала RPC ученика не зовётся вовсе.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { useCourseAssessmentsSummary, useMyCourseAssessments } from '@/hooks/useCourseAssessments'

beforeEach(() => rpc.mockReset())

describe('useMyCourseAssessments', () => {
  it('ответ базы — ready с разобранными данными', async () => {
    rpc.mockResolvedValue({ data: { server_now: '2026-10-02T07:00:00Z', works: [{ topic_id: 't', kind: 'check', title: 'П', status: 'none' }], mocks: [] }, error: null })
    const { result } = renderHook(() => useMyCourseAssessments('g1'))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.works[0].kind).toBe('check')
    expect(rpc).toHaveBeenCalledWith('my_course_assessments', { p_group_id: 'g1' })
  })
  it('ошибка RPC — error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useMyCourseAssessments('g1'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    warn.mockRestore()
  })
  it('выключен (предпросмотр) — idle, RPC не зовётся', () => {
    const { result } = renderHook(() => useMyCourseAssessments('g1', false))
    expect(result.current.status).toBe('idle')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('useCourseAssessmentsSummary', () => {
  it('перечитывается по refreshKey', async () => {
    rpc.mockResolvedValue({ data: { server_now: '2026-10-02T07:00:00Z', is_template: false, in_class: 3, works: [], mocks: [] }, error: null })
    const { result, rerender } = renderHook(({ k }) => useCourseAssessmentsSummary('c1', k), { initialProps: { k: 0 } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    rerender({ k: 1 })
    expect(result.current.status).toBe('ready')
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    expect(rpc).toHaveBeenLastCalledWith('course_assessments_summary', { p_course_id: 'c1' })
  })
})
