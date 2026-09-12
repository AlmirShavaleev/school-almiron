import { createSelectionStore } from '@/store/selectionStore'

const CART_STORAGE_KEY = 'almiron-cart'

/**
 * Обычная подборка каталога.
 *
 * Отбор задач к уроку идёт своим набором (`attachStore`, §164) и эту подборку
 * не трогает: выход из режима подбора возвращает её ровно такой, какой человек
 * её оставил. Сама логика отбора у обоих наборов одна — см. `selectionStore`.
 */
export const useCartStore = createSelectionStore(CART_STORAGE_KEY)
