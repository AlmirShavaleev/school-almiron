import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * §164. Режим подбора задач к уроку поверх каталога.
 *
 * Проверяем то, за что владелец и просил: видно, кому подбираем; кнопка в углу
 * говорит «Прикрепить к теме», а не «Подборка»; подтверждение показывает состав;
 * после прикрепления возвращаемся на тему, а обычная подборка цела.
 */

const rpcSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcSpy(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
}))

vi.mock('@/store/toastStore', () => ({
  toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { CatalogAttachMode } from '@/components/catalog/CatalogAttachMode'
import { CartBadge } from '@/components/catalog/CartBadge'
import { useCartStore } from '@/store/cartStore'
import { useAttachSelectionStore, useAttachTargetStore } from '@/store/attachStore'
import { useAuthStore } from '@/store/authStore'

const TARGET = {
  topicId:     'topic-1',
  topicTitle:  'Равноускоренное движение',
  courseTitle: 'Физика ЕГЭ 11А',
  returnTo:    '/course-program?courseId=c1&materialsTopic=topic-1&tile=test',
}

function renderCatalog() {
  return render(
    <MemoryRouter initialEntries={['/catalog']}>
      <Routes>
        <Route element={<CatalogAttachMode />}>
          <Route path="/catalog" element={<div>Каталог заданий</div>} />
        </Route>
        <Route path="/course-program" element={<div>Программа курса</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Режим подбора задач к уроку (§164)', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    window.localStorage.clear()
    useCartStore.getState().clearCart()
    useAttachSelectionStore.getState().clearCart()
    useAttachTargetStore.getState().clearTarget()
    useAuthStore.setState({ profile: { id: 'p1', role: 'teacher' } as never })
  })

  it('вне режима каталог не показывает ни полосы, ни кнопки «Прикрепить»', () => {
    useAttachSelectionStore.getState().addItem('task-1')
    renderCatalog()

    expect(screen.queryByTestId('attach-context-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attach-fab')).not.toBeInTheDocument()
  })

  it('полоса называет тему и курс, кнопка считает отобранное', () => {
    useAttachTargetStore.getState().setTarget(TARGET)
    useAttachSelectionStore.getState().addItem('task-1')
    useAttachSelectionStore.getState().addItem('task-2')
    renderCatalog()

    expect(screen.getByTestId('attach-context-bar')).toHaveTextContent('Равноускоренное движение')
    expect(screen.getByTestId('attach-context-bar')).toHaveTextContent('Физика ЕГЭ 11А')
    expect(screen.getByTestId('attach-fab')).toHaveTextContent('Прикрепить к теме · 2')
  })

  it('пока идёт подбор, кнопка подборки не спорит за тот же угол', () => {
    useCartStore.getState().addItem('в-подборке')
    useAttachTargetStore.getState().setTarget(TARGET)

    const { unmount } = render(
      <MemoryRouter>
        <CartBadge />
      </MemoryRouter>
    )
    expect(screen.queryByTestId('cart-badge')).not.toBeInTheDocument()
    unmount()

    useAttachTargetStore.getState().clearTarget()
    render(
      <MemoryRouter>
        <CartBadge />
      </MemoryRouter>
    )
    expect(screen.getByTestId('cart-badge')).toHaveTextContent('Подборка · 1')
  })

  it('«Отменить» выключает режим и возвращает на тему, подборка цела', () => {
    useCartStore.getState().addItem('в-подборке')
    useAttachTargetStore.getState().setTarget(TARGET)
    useAttachSelectionStore.getState().addItem('task-1')
    renderCatalog()

    fireEvent.click(screen.getByText('Отменить'))

    expect(useAttachTargetStore.getState().target).toBeNull()
    expect(useAttachSelectionStore.getState().items).toHaveLength(0)
    expect(useCartStore.getState().items.map(i => i.catalog_task_id)).toEqual(['в-подборке'])
    expect(screen.getByText('Программа курса')).toBeInTheDocument()
  })

  it('подтверждение показывает состав и прикрепляет отобранное одним вызовом', async () => {
    rpcSpy.mockImplementation((fn: string) => {
      if (fn === 'catalog_tasks_attach_preview') {
        return Promise.resolve({ data: { total: 2, auto_checkable: 1, self_checked: 1, part_two: 1 }, error: null })
      }
      return Promise.resolve({ data: { added: 2, skipped: 0, total: 2 }, error: null })
    })

    useAttachTargetStore.getState().setTarget(TARGET)
    useAttachSelectionStore.getState().addItem('task-1')
    useAttachSelectionStore.getState().addItem('task-2')
    renderCatalog()

    fireEvent.click(screen.getByTestId('attach-fab'))

    expect(await screen.findByText('Задач: 2')).toBeInTheDocument()
    expect(screen.getByText(/с автопроверкой — 1/)).toBeInTheDocument()
    expect(screen.getByText(/самопроверка по решению — 1/)).toBeInTheDocument()
    expect(screen.getByText(/вторая часть — 1/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('attach-confirm'))

    await waitFor(() => {
      expect(rpcSpy).toHaveBeenCalledWith('attach_catalog_tasks_to_topic', {
        p_topic_id: 'topic-1',
        p_task_ids: ['task-1', 'task-2'],
      })
    })

    // Вернулись на тему, режим выключен, отобранное выброшено.
    await screen.findByText('Программа курса')
    expect(useAttachTargetStore.getState().target).toBeNull()
    expect(useAttachSelectionStore.getState().items).toHaveLength(0)
  })
})
