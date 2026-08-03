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

  // Раньше хук добирал max_points, эталон и решение прямым запросом к
  // catalog_tasks. Это обходило get_variant_items_for_student, который один и
  // решает, что ученику видно по статусу попытки. Теперь всё приходит из RPC, и
  // catalog_tasks хук не трогает вовсе (§52).
  it('does not read catalog_tasks before submit', async () => {
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
            partial_type: null,
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

    expect(catalogTasksSelectMock).not.toHaveBeenCalled()
  })

  it('reveals reference answer and solution from the RPC after submit', async () => {
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
            partial_type: null,
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
    // Первый вызов приходит, пока состояние ещё помнит попытку незавершённой,
    // и эталон в нём пуст — ровно так ведёт себя сервер. Хук обязан перечитать
    // задачи тем же RPC и показать эталон с решением: самопроверка после сдачи
    // часть продукта, пережимать нельзя.
    let itemsCall = 0
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'get_variant_items_for_student') {
        itemsCall += 1
        const revealed = itemsCall > 1
        return {
          data: [{
            item_id: 'item-1',
            variant_id: 'variant-1',
            task_id: 'task-1',
            item_position: 1,
            points: 0,
            max_points: 2,
            grading_type: 'auto',
            task_ext_id: revealed ? 13 : null,
            section_id: null,
            subject: 'Математика',
            exam_type: 'ЕГЭ',
            partial_type: null,
            statement_html: '<p>...</p>',
            has_answer: true,
            has_solution: true,
            exam_part: 2,
            source_type: 'student_self_built',
            solution_html:       revealed ? '<p>Решение</p>' : null,
            solution_plan_html:  revealed ? '<p>План</p>'    : null,
            grade_criteria_html: revealed ? '<p>Критерии</p>' : null,
            answer_html:         revealed ? '<p>6</p>'       : null,
          }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const { result } = renderHook(() => useVariantAttempt(
      'assign-1',
      'submitted',
      '2026-07-13T09:00:00Z',
      null,
      '2026-07-13T10:00:00Z',
      null,
    ))

    await waitFor(() => expect(result.current.items[0]?.solution_html).toBe('<p>Решение</p>'))
    expect(result.current.items[0]?.grade_criteria_html).toBe('<p>Критерии</p>')
    expect(result.current.items[0]?.answer_html).toBe('<p>6</p>')
    expect(result.current.items[0]?.task_ext_id).toBe(13)
    // Ответы пришли из RPC, а не из каталога в обход проверки.
    expect(catalogTasksSelectMock).not.toHaveBeenCalled()
  })
})
