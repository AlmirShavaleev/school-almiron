import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createSelectionStore } from '@/store/selectionStore'

/**
 * Режим подбора задач к уроку (§164).
 *
 * Контекст держим в хранилище, а не в адресе: каталог — это четыре страницы
 * (каталог, раздел, тема, задача), и по адресу его пришлось бы тащить в каждой
 * ссылке, теряя на первом же переходе внутрь каталога. В хранилище он переживает
 * и переходы, и обновление страницы, и открытие каталога во второй вкладке.
 *
 * Адрес `/catalog?attachTo=<id>` остаётся входом: по нему режим включается, если
 * в хранилище его ещё нет.
 */

const TARGET_STORAGE_KEY    = 'almiron-attach-target'
const SELECTION_STORAGE_KEY = 'almiron-attach-selection'

export interface AttachTarget {
  topicId:     string
  topicTitle:  string
  courseTitle: string
  /** Куда вернуться после прикрепления — страница темы у преподавателя. */
  returnTo:    string
}

interface AttachTargetStore {
  target: AttachTarget | null
  setTarget:   (target: AttachTarget) => void
  clearTarget: () => void
}

export const useAttachTargetStore = create<AttachTargetStore>()(
  persist(
    (set) => ({
      target: null,
      setTarget:   (target) => set({ target }),
      clearTarget: () => set({ target: null }),
    }),
    {
      name: TARGET_STORAGE_KEY,
      partialize: (s) => ({ target: s.target }),
    }
  )
)

/** Отобранное в режиме подбора. Отдельный ключ — обычная подборка не страдает. */
export const useAttachSelectionStore = createSelectionStore(SELECTION_STORAGE_KEY)

/** Выход из режима: цель снимается, отобранное выбрасывается. */
export function leaveAttachMode() {
  useAttachSelectionStore.getState().clearCart()
  useAttachTargetStore.getState().clearTarget()
}
