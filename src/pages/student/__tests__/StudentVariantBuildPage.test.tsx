import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useCartStore } from '@/store/cartStore'
import { StudentVariantBuildPage } from '@/pages/student/StudentVariantBuildPage'

const variantPrintPanelSpy = vi.fn()

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

vi.mock('@/components/catalog/TaskDisplayCard', () => ({
  TaskDisplayCard: ({ task, extraActions, number }: { task: { id: string }; extraActions?: ReactNode; number?: number }) => (
    <div data-testid={`build-task-${task.id}`}>
      <span>{number}</span>
      <span>{task.id}</span>
      {extraActions}
    </div>
  ),
}))

vi.mock('@/components/pdf/VariantPrintPanel', () => ({
  VariantPrintPanel: (props: unknown) => {
    variantPrintPanelSpy(props)
    return <div data-testid="variant-print-panel" />
  },
}))

describe('StudentVariantBuildPage — dedicated cart PDF preview page', () => {
  beforeEach(() => {
    variantPrintPanelSpy.mockReset()
    useCartStore.setState({ items: [] })
  })

  it('shows cart tasks and renders the shared print panel on a separate page', () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')

    render(
      <MemoryRouter initialEntries={['/student/variants/build']}>
        <Routes>
          <Route path="/student/variants/build" element={<StudentVariantBuildPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('PDF из корзины')).toBeInTheDocument()
    expect(screen.getByText('Вернуться в корзину')).toHaveAttribute('href', '/cart')
    expect(screen.getByTestId('build-task-task-1')).toBeInTheDocument()
    expect(screen.getByTestId('build-task-task-2')).toBeInTheDocument()
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
  })

  it('shows empty state when the cart has no tasks', () => {
    render(
      <MemoryRouter initialEntries={['/student/variants/build']}>
        <Routes>
          <Route path="/student/variants/build" element={<StudentVariantBuildPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Корзина пуста')).toBeInTheDocument()
    expect(variantPrintPanelSpy).not.toHaveBeenCalled()
  })
})
