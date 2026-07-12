import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const rpcSpy = vi.fn()
const navigateSpy = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'catalog_tasks') {
        return {
          select: () => ({
            in: () => ({
              eq: () => Promise.resolve({
                data: [
                  {
                    id: 'task-1', external_id: 1, section_id: 'sec-1', subject: 'Математика', exam_type: 'ЕГЭ',
                    statement_html: '<p>Задача 1</p>', answer_html: '5', solution_html: null, solution_plan_html: null,
                    grade_criteria_html: null, source_url: null, has_answer: true, has_solution: false, position: 1, exam_part: 1,
                  },
                  {
                    id: 'task-2', external_id: 2, section_id: 'sec-2', subject: 'Математика', exam_type: 'ЕГЭ',
                    statement_html: '<p>Задача 2</p>', answer_html: null, solution_html: '<p>Решение</p>', solution_plan_html: null,
                    grade_criteria_html: '<p>Критерии</p>', source_url: null, has_answer: false, has_solution: true, position: 2, exam_part: 2,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }
      }
      // catalog_task_assets (and anything else) — no assets needed for this test.
      return {
        select: () => ({
          in: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }
    },
    rpc: (...args: unknown[]) => { rpcSpy(...args); return Promise.resolve({ data: 'student-assignment-1', error: null }) },
  },
}))

// Stable module-level object — recreating it inside the mock body would give
// every call a new `profile` reference, which turns useCatalogTasksBatch's
// `[profile, idsKey]` effect into an infinite render loop (each fetch
// completion re-renders → new profile object → effect deps "changed" →
// fetch again → re-render...).
const AUTH_STATE = { profile: { id: 'stud-profile-1', role: 'student' } }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: typeof AUTH_STATE) => unknown) =>
    selector ? selector(AUTH_STATE) : AUTH_STATE,
}))

import { useCartStore } from '@/store/cartStore'
import { StudentVariantBuildPage } from '@/pages/student/StudentVariantBuildPage'

describe('StudentVariantBuildPage — self-built variant RPC call', () => {
  beforeEach(() => {
    rpcSpy.mockClear()
    navigateSpy.mockClear()
    useCartStore.setState({ items: [] })
  })

  it('sends task_id/section_id for every cart item and navigates to the new self-assignment on success', async () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')

    render(
      <MemoryRouter initialEntries={['/student/variants/build']}>
        <Routes>
          <Route path="/student/variants/build" element={<StudentVariantBuildPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Задача 2')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('self-build-title-input'), { target: { value: 'Мой вариант' } })
    fireEvent.click(screen.getByTestId('self-build-submit'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1))
    const [name, payload] = rpcSpy.mock.calls[0] as [string, any]
    expect(name).toBe('create_self_built_variant')
    expect(payload.p_title).toBe('Мой вариант')
    expect(payload.p_items).toEqual([
      { task_id: 'task-1', pos: 1, section_id: 'sec-1', topic_id: null, points: 1 },
      { task_id: 'task-2', pos: 2, section_id: 'sec-2', topic_id: null, points: 1 },
    ])

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/student/variants/student-assignment-1'))
    // Cart is cleared once the variant is created, closing the loop for the next build.
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('shows both exam-part labels so the student knows which items are self-checked', async () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')

    render(
      <MemoryRouter initialEntries={['/student/variants/build']}>
        <Routes>
          <Route path="/student/variants/build" element={<StudentVariantBuildPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('self-build-item-part-task-1')).toHaveTextContent('Часть 1'))
    expect(screen.getByTestId('self-build-item-part-task-2')).toHaveTextContent('Часть 2')
  })

  it('does not call the RPC when the cart is empty (empty state shown instead)', () => {
    render(
      <MemoryRouter initialEntries={['/student/variants/build']}>
        <Routes>
          <Route path="/student/variants/build" element={<StudentVariantBuildPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Вариант пока пуст')).toBeInTheDocument()
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
