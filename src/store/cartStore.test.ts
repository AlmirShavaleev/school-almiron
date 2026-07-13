import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from './cartStore'

const CART_STORAGE_KEY = 'almiron-cart'

function persistItems(taskIds: string[]) {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({
      state: {
        items: taskIds.map((taskId, index) => ({
          catalog_task_id: taskId,
          added_at: index + 1,
        })),
      },
      version: 0,
    })
  )
}

// Reset store between tests
beforeEach(() => {
  useCartStore.setState({ items: [] })
  window.localStorage.clear()
})

describe('cartStore', () => {
  it('adds item', () => {
    const result = useCartStore.getState().addItem('task-1')
    expect(result).toBe('added')
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].catalog_task_id).toBe('task-1')
  })

  it('deduplicates', () => {
    useCartStore.getState().addItem('task-1')
    const result = useCartStore.getState().addItem('task-1')
    expect(result).toBe('already_in_cart')
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it('removes item', () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')
    useCartStore.getState().removeItem('task-1')
    const ids = useCartStore.getState().items.map(i => i.catalog_task_id)
    expect(ids).toEqual(['task-2'])
  })

  it('clears cart', () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')
    useCartStore.getState().clearCart()
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('hasItem', () => {
    useCartStore.getState().addItem('task-1')
    expect(useCartStore.getState().hasItem('task-1')).toBe(true)
    expect(useCartStore.getState().hasItem('task-2')).toBe(false)
  })

  it('moveItem swaps positions', () => {
    useCartStore.getState().addItem('task-1')
    useCartStore.getState().addItem('task-2')
    useCartStore.getState().addItem('task-3')
    useCartStore.getState().moveItem(0, 2)
    const ids = useCartStore.getState().items.map(i => i.catalog_task_id)
    expect(ids).toEqual(['task-2', 'task-3', 'task-1'])
  })

  it('moveItem ignores out-of-bound index', () => {
    useCartStore.getState().addItem('task-1')
    const before = [...useCartStore.getState().items]
    useCartStore.getState().moveItem(0, 5)
    expect(useCartStore.getState().items).toEqual(before)
  })

  it('added_at is a number', () => {
    useCartStore.getState().addItem('task-1')
    const item = useCartStore.getState().items[0]
    expect(typeof item.added_at).toBe('number')
    expect(item.added_at).toBeGreaterThan(0)
  })

  it('preserves items across multiple add/remove cycles', () => {
    for (let i = 0; i < 5; i++) {
      useCartStore.getState().addItem(`task-${i}`)
    }
    useCartStore.getState().removeItem('task-2')
    const ids = useCartStore.getState().items.map(i => i.catalog_task_id)
    expect(ids).toEqual(['task-0', 'task-1', 'task-3', 'task-4'])
  })

  it('merges persisted cart before adding, preserving items from another tab', () => {
    useCartStore.getState().addItem('task-a')
    persistItems(['task-a', 'task-b'])

    const result = useCartStore.getState().addItem('task-c')

    expect(result).toBe('added')
    expect(useCartStore.getState().items.map(i => i.catalog_task_id)).toEqual(['task-a', 'task-b', 'task-c'])
  })

  it('rehydrates from storage event fired by another tab', () => {
    persistItems(['task-a', 'task-b'])

    window.dispatchEvent(new StorageEvent('storage', {
      key: CART_STORAGE_KEY,
      newValue: window.localStorage.getItem(CART_STORAGE_KEY),
      storageArea: window.localStorage,
    }))

    expect(useCartStore.getState().items.map(i => i.catalog_task_id)).toEqual(['task-a', 'task-b'])
  })
})
