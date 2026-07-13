import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVariantAttempt } from '@/hooks/useVariantAttempt'

const rpcMock = vi.hoisted(() => vi.fn())
const catalogTasksSelectMock = vi.hoisted(() => vi.fn())
const catalogTasksInMock = vi.hoisted(() => vi.fn())
const catalogAssetsSelectMock = vi.hoisted(() => vi.fn())
const catalogAssetsInMock = vi.hoisted(() => vi.fn())
const catalogAssetsOrderMock = vi.hoisted(() => vi.fn())
const catalogAssetsRangeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => {
  const answersQuery = {
    select: vi.fn(() => answersQuery),
    eq: vi.fn(async () => ({ data: [], error: null })),
  }
  const catalogTasksQuery = {
    select: catalogTasksSelectMock,
    in: catalogTasksInMock,
  }
  const catalogAssetsQuery = {
    select: catalogAssetsSelectMock,
  }

  return {
    supabase: {
      rpc: rpcMock,
      from: vi.fn((table: string) => {
        if (table === 'catalog_tasks') {
          return catalogTasksQuery
        }
        if (table === 'catalog_task_assets') {
          return catalogAssetsQuery
        }
        if (table === 'test_variant_answers' || table === 'test_variant_answer_attachments') {
          return answersQuery
        }
        return {
          select: vi.fn(() => answersQuery),
          eq: vi.fn(async () => ({ data: [], error: null })),
          in: vi.fn(() => answersQuery),
          order: vi.fn(() => answersQuery),
          range: vi.fn(async () => ({ data: [], error: null })),
        }
      }),
    },
  }
})

describe('useVariantAttempt submit flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rpcMock.mockReset()
    catalogTasksSelectMock.mockReset()
    catalogTasksInMock.mockReset()
    catalogAssetsSelectMock.mockReset()
    catalogAssetsInMock.mockReset()
    catalogAssetsOrderMock.mockReset()
    catalogAssetsRangeMock.mockReset()
    catalogTasksSelectMock.mockReturnValue({
      in: catalogTasksInMock,
    })
    catalogTasksInMock.mockResolvedValue({ data: [], error: null })
    catalogAssetsSelectMock.mockReturnValue({
      in: catalogAssetsInMock,
    })
    catalogAssetsInMock.mockReturnValue({
      order: catalogAssetsOrderMock,
    })
    catalogAssetsOrderMock.mockReturnValue({
      range: catalogAssetsRangeMock,
    })
    catalogAssetsRangeMock.mockResolvedValue({ data: [], error: null })
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'save_variant_answer') return { data: null, error: null }
      if (name === 'submit_variant') {
        return {
          data: {
            status: 'submitted',
            answered_count: 1,
            correct_count: 1,
            score: 1,
            max_score: 1,
            percentage: 100,
            grading_status: 'auto_graded',
            manual_review_count: 0,
            submitted_at: '2026-07-13T10:00:00Z',
            completed_at: '2026-07-13T10:00:00Z',
          },
          error: null,
        }
      }
      return { data: [], error: null }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes debounced answer saves before submit', async () => {
    const { result } = renderHook(() => useVariantAttempt(
      'assign-1',
      'not_started',
      null,
      null,
      null,
      null,
    ))

    act(() => {
      result.current.setAnswer('item-1', '42')
    })

    await act(async () => {
      await result.current.submitVariant()
    })

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'save_variant_answer', {
      p_student_assignment_id: 'assign-1',
      p_variant_item_id: 'item-1',
      p_answer_raw: '42',
    })
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'submit_variant', {
      p_student_assignment_id: 'assign-1',
    })
    expect(result.current.attempt?.status).toBe('submitted')

    act(() => {
      vi.runOnlyPendingTimers()
    })
  })

  it('does not request self-check fields before submit', async () => {
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'get_variant_items_for_student') {
        return {
          data: [{
            item_id: 'item-1',
            variant_id: 'variant-1',
            task_id: 'task-1',
            item_position: 1,
            points: 0,
            max_points: null,
            grading_type: 'auto',
            task_ext_id: 13,
            section_id: null,
            subject: 'Математика',
            exam_type: 'ЕГЭ',
            statement_html: '<p>...</p>',
            has_answer: false,
            has_solution: true,
            exam_part: 2,
            source_type: 'student_self_built',
            solution_html: null,
            solution_plan_html: null,
            grade_criteria_html: null,
            answer_html: null,
          }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    renderHook(() => useVariantAttempt(
      'assign-1',
      'in_progress',
      '2026-07-13T09:00:00Z',
      null,
      null,
      null,
    ))

    await act(async () => {})

    expect(catalogTasksSelectMock).toHaveBeenCalledWith('id, max_points')
  })

  it('loads self-check fields from catalog_tasks only after submit for self-built variants', async () => {
    vi.useRealTimers()
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'get_variant_items_for_student') {
        return {
          data: [{
            item_id: 'item-1',
            variant_id: 'variant-1',
            task_id: 'task-1',
            item_position: 1,
            points: 0,
            max_points: null,
            grading_type: 'auto',
            task_ext_id: 13,
            section_id: null,
            subject: 'Математика',
            exam_type: 'ЕГЭ',
            statement_html: '<p>...</p>',
            has_answer: false,
            has_solution: true,
            exam_part: 2,
            source_type: 'student_self_built',
            solution_html: null,
            solution_plan_html: null,
            grade_criteria_html: null,
            answer_html: null,
          }],
          error: null,
        }
      }
      if (name === 'submit_variant') {
        return {
          data: {
            status: 'submitted',
            answered_count: 0,
            correct_count: 0,
            score: 0,
            max_score: 12,
            percentage: 0,
            grading_status: 'auto_graded',
            manual_review_count: 0,
            submitted_at: '2026-07-13T10:00:00Z',
            completed_at: '2026-07-13T10:00:00Z',
          },
          error: null,
        }
      }
      return { data: [], error: null }
    })
    catalogTasksInMock.mockResolvedValue({
      data: [{
        id: 'task-1',
        max_points: 2,
        answer_html: '<p>6</p>',
        solution_html: '<p>Решение</p>',
        solution_plan_html: '<p>План</p>',
        grade_criteria_html: '<p>Критерии</p>',
      }],
      error: null,
    })

    const { result } = renderHook(() => useVariantAttempt(
      'assign-1',
      'submitted',
      '2026-07-13T09:00:00Z',
      null,
      '2026-07-13T10:00:00Z',
      null,
    ))

    await waitFor(() => {
      expect(catalogTasksSelectMock).toHaveBeenCalledWith('id, max_points, answer_html, solution_html, solution_plan_html, grade_criteria_html')
    })
    await waitFor(() => expect(result.current.items[0]?.solution_html).toBe('<p>Решение</p>'))
    expect(result.current.items[0]?.grade_criteria_html).toBe('<p>Критерии</p>')
  })
})
