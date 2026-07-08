import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '@/types/collections'

interface CartStore {
  items: CartItem[]
  addItem:        (taskId: string) => 'added' | 'already_in_cart'
  removeItem:     (taskId: string) => void
  moveItem:       (fromIndex: number, toIndex: number) => void
  clearCart:      () => void
  hasItem:        (taskId: string) => boolean
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (taskId) => {
        if (get().items.some(i => i.catalog_task_id === taskId)) {
          return 'already_in_cart'
        }
        set(s => ({ items: [...s.items, { catalog_task_id: taskId, added_at: Date.now() }] }))
        return 'added'
      },

      removeItem: (taskId) => {
        set(s => ({ items: s.items.filter(i => i.catalog_task_id !== taskId) }))
      },

      moveItem: (fromIndex, toIndex) => {
        set(s => {
          if (fromIndex < 0 || fromIndex >= s.items.length) return s
          if (toIndex   < 0 || toIndex   >= s.items.length) return s
          const items = [...s.items]
          const [item] = items.splice(fromIndex, 1)
          items.splice(toIndex, 0, item)
          return { items }
        })
      },

      clearCart: () => set({ items: [] }),

      hasItem: (taskId) => get().items.some(i => i.catalog_task_id === taskId),
    }),
    {
      name: 'almiron-cart',
      partialize: (s) => ({ items: s.items }),
    }
  )
)
