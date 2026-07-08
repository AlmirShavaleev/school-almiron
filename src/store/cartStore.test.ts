import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from './cartStore'

// Reset store between tests
beforeEach(() => {
  useCartStore.setState({ items: [] })
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
})
