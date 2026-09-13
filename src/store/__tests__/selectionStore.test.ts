import { describe, expect, it, beforeEach } from 'vitest'
import { createSelectionStore } from '@/store/selectionStore'
import { useCartStore } from '@/store/cartStore'
import { useAttachSelectionStore, useAttachTargetStore, leaveAttachMode } from '@/store/attachStore'

/**
 * §164. Отбор задач к уроку идёт своим набором.
 *
 * Главное требование владельца к режиму: обычная подборка после выхода из него
 * должна остаться такой, какой была. Здесь это и проверяется — на уровне
 * хранилищ, а не картинки.
 */

describe('createSelectionStore — два набора не мешают друг другу', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useCartStore.getState().clearCart()
    useAttachSelectionStore.getState().clearCart()
    useAttachTargetStore.getState().clearTarget()
  })

  it('подбор в тему не трогает подборку', () => {
    useCartStore.getState().addItem('task-в-подборке')

    useAttachSelectionStore.getState().addItem('task-в-тему-1')
    useAttachSelectionStore.getState().addItem('task-в-тему-2')

    expect(useCartStore.getState().items.map(i => i.catalog_task_id)).toEqual(['task-в-подборке'])
    expect(useAttachSelectionStore.getState().items).toHaveLength(2)
  })

  it('выход из режима выбрасывает отобранное и возвращает подборку как была', () => {
    useCartStore.getState().addItem('task-в-подборке')
    useAttachTargetStore.getState().setTarget({
      topicId: 't1', topicTitle: 'Тема', courseTitle: 'Курс', returnTo: '/course-program',
    })
    useAttachSelectionStore.getState().addItem('task-в-тему')

    leaveAttachMode()

    expect(useAttachTargetStore.getState().target).toBeNull()
    expect(useAttachSelectionStore.getState().items).toHaveLength(0)
    expect(useCartStore.getState().items.map(i => i.catalog_task_id)).toEqual(['task-в-подборке'])
  })

  it('дубли не кладутся ни в один из наборов', () => {
    const store = createSelectionStore('almiron-test-selection')
    expect(store.getState().addItem('одна-и-та-же')).toBe('added')
    expect(store.getState().addItem('одна-и-та-же')).toBe('already_in_cart')
    expect(store.getState().items).toHaveLength(1)
  })

  it('порядок отбора сохраняется — задачи лягут в тему в нём же', () => {
    const store = createSelectionStore('almiron-test-order')
    store.getState().addItem('первая')
    store.getState().addItem('вторая')
    store.getState().addItem('третья')

    expect(store.getState().items.map(i => i.catalog_task_id)).toEqual(['первая', 'вторая', 'третья'])
  })
})
