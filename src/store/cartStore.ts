import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '@/types/collections'

const CART_STORAGE_KEY = 'almiron-cart'

interface CartStore {
  items: CartItem[]
  addItem:        (taskId: string) => 'added' | 'already_in_cart'
  removeItem:     (taskId: string) => void
  moveItem:       (fromIndex: number, toIndex: number) => void
  clearCart:      () => void
  hasItem:        (taskId: string) => boolean
}

function dedupeItems(items: CartItem[]): CartItem[] {
  const seen = new Set<string>()
  const result: CartItem[] = []
  for (const item of items) {
    if (seen.has(item.catalog_task_id)) continue
    seen.add(item.catalog_task_id)
    result.push(item)
  }
  return result
}

function readPersistedItems(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { state?: { items?: CartItem[] } }
    return Array.isArray(parsed.state?.items) ? dedupeItems(parsed.state.items) : []
  } catch {
    return []
  }
}

function syncWithPersistedState(items: CartItem[]): CartItem[] {
  return dedupeItems([...readPersistedItems(), ...items])
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (taskId) => {
        const items = syncWithPersistedState(get().items)
        if (items.some(i => i.catalog_task_id === taskId)) {
          set({ items })
          return 'already_in_cart'
        }
        set({
          items: [...items, { catalog_task_id: taskId, added_at: Date.now() }],
        })
        return 'added'
      },

      removeItem: (taskId) => {
        const items = syncWithPersistedState(get().items)
        set({ items: items.filter(i => i.catalog_task_id !== taskId) })
      },

      moveItem: (fromIndex, toIndex) => {
        const items = syncWithPersistedState(get().items)
        if (fromIndex < 0 || fromIndex >= items.length) return
        if (toIndex   < 0 || toIndex   >= items.length) return
        const next = [...items]
        const [item] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, item)
        set({ items: next })
      },

      clearCart: () => set({ items: [] }),

      hasItem: (taskId) => get().items.some(i => i.catalog_task_id === taskId),
    }),
    {
      name: CART_STORAGE_KEY,
      partialize: (s) => ({ items: s.items }),
    }
  )
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== CART_STORAGE_KEY) return
    useCartStore.setState({ items: readPersistedItems() })
  })
}
