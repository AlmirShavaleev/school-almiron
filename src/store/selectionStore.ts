import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '@/types/collections'

/**
 * Отбор задач в каталоге. Одна реализация на два набора (§164).
 *
 * Наборов стало два: обычная подборка и отбор «в тему», который каталог ведёт,
 * пока преподаватель подбирает задачи к уроку. Правила у них одинаковые —
 * порядок, отсутствие дублей, синхронизация между вкладками, — а хранилища
 * разные: иначе подбор в тему затирал бы подборку, с которой человек работал.
 *
 * Отсюда фабрика: логика отбора одна, ключей хранения два.
 */

export interface SelectionStore {
  items: CartItem[]
  addItem:    (taskId: string) => 'added' | 'already_in_cart'
  removeItem: (taskId: string) => void
  moveItem:   (fromIndex: number, toIndex: number) => void
  clearCart:  () => void
  hasItem:    (taskId: string) => boolean
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

function readPersistedItems(storageKey: string): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { state?: { items?: CartItem[] } }
    return Array.isArray(parsed.state?.items) ? dedupeItems(parsed.state.items) : []
  } catch {
    return []
  }
}

export function createSelectionStore(storageKey: string) {
  const syncWithPersistedState = (items: CartItem[]): CartItem[] =>
    dedupeItems([...readPersistedItems(storageKey), ...items])

  const useStore = create<SelectionStore>()(
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
        name: storageKey,
        partialize: (s) => ({ items: s.items }),
      }
    )
  )

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey) return
      useStore.setState({ items: readPersistedItems(storageKey) })
    })
  }

  return useStore
}
