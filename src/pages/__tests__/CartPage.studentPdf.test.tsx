import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CartPage } from '@/pages/CartPage'
import { useCartStore } from '@/store/cartStore'

const navigateSpy = vi.fn()
const variantPrintPanelSpy = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (state: { profile: { role: 'student' } }) => unknown) => {
    const state = { profile: { role: 'student' as const } }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/hooks/useCollections', () => ({
  useSaveCollection: () => ({ save: vi.fn(), loading: false, error: null }),
}))

vi.mock('@/hooks/useCatalog', () => ({
  useCatalogTasksBatch: (taskIds: string[]) => ({
    loading: false,
    tasks: taskIds.map((taskId, index) => ({
      id: taskId,
      external_id: index + 1,
      section_id: 'section-1',
      subject: 'Математика',
      exam_type: 'ЕГЭ',
      statement_html: `<p>${taskId}</p>`,
      answer_html: '<p>42</p>',
      solution_html: '<p>Решение</p>',
      solution_plan_html: null,
      grade_criteria_html: null,
      source_url: null,
      has_answer: true,
      has_solution: true,
      position: index + 1,
      exam_part: 1,
      assets: index === 0 ? [{ id: 'asset-1', tex_session_id: null, kind: 'image', storage_path: 'img/task-1.png', alt: 'figure', position: 1 }] : [],
      sectionTitle: 'Планиметрия',
    })),
    error: null,
  }),
}))

vi.mock('@/components/catalog/TaskContentRenderer', () => ({
  TaskContentRenderer: ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />,
}))

vi.mock('@/components/catalog/TaskDisplayCard', () => ({
  TaskDisplayCard: ({ task, extraActions, number }: { task: { id: string }; extraActions?: ReactNode; number?: number }) => (
    <div data-testid={`cart-task-${task.id}`}>
      <span>{number}</span>
      <span>{task.id}</span>
      {extraActions}
    </div>
  ),
}))

vi.mock('@/utils/resolveTaskHtml', () => ({
  resolveTaskHtml: (html: string) => html,
}))

vi.mock('@/components/pdf/VariantPrintPanel', () => ({
  VariantPrintPanel: (props: unknown) => {
    variantPrintPanelSpy(props)
    return <div data-testid="variant-print-panel" />
  },
}))

describe('CartPage student PDF flow', () => {
  beforeEach(() => {
    navigateSpy.mockReset()
    variantPrintPanelSpy.mockReset()
    useCartStore.setState({ items: [] })
  })

  it('renders a single shared PDF entrypoint and passes full cart tasks to the teacher-style print panel', () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')

    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.queryByText('Сохранить подборку')).not.toBeInTheDocument()
    expect(screen.getByTestId('cart-task-task-1')).toBeInTheDocument()
    expect(screen.getByTestId('cart-task-task-2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('PDF'))

    expect(screen.getByTestId('variant-print-panel')).toBeInTheDocument()
    expect(variantPrintPanelSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      subject: 'Математика',
      examType: 'ЕГЭ',
      initialTitle: 'Подборка из каталога',
      items: expect.arrayContaining([
        expect.objectContaining({
          task: expect.objectContaining({
            id: 'task-1',
            assets: expect.arrayContaining([
              expect.objectContaining({ storage_path: 'img/task-1.png' }),
            ]),
          }),
        }),
        expect.objectContaining({
          task: expect.objectContaining({ id: 'task-2' }),
        }),
      ]),
    }))
    const lastCall = variantPrintPanelSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(lastCall.lockedSettings).toBeUndefined()
    expect(lastCall.hideSettingsPanel).toBeUndefined()
    expect(lastCall.initialSettingsOverride).toBeUndefined()
  })
})
