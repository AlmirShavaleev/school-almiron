import { useCartStore } from '@/store/cartStore'
import { useAttachSelectionStore, useAttachTargetStore } from '@/store/attachStore'

/**
 * Куда каталог кладёт отобранное прямо сейчас (§164).
 *
 * Обычно — в подборку. Пока включён режим подбора задач к уроку — в его
 * собственный набор. Кнопки каталога спрашивают отсюда и больше ничего про
 * режим не знают: это единственное место, где выбирается набор.
 */
export function useActiveSelection() {
  const attachMode  = useAttachTargetStore(s => s.target !== null)

  const cartItems   = useCartStore(s => s.items)
  const cartAdd     = useCartStore(s => s.addItem)
  const cartRemove  = useCartStore(s => s.removeItem)

  const attachItems  = useAttachSelectionStore(s => s.items)
  const attachAdd    = useAttachSelectionStore(s => s.addItem)
  const attachRemove = useAttachSelectionStore(s => s.removeItem)

  return attachMode
    ? { attachMode: true,  items: attachItems, addItem: attachAdd, removeItem: attachRemove }
    : { attachMode: false, items: cartItems,   addItem: cartAdd,   removeItem: cartRemove }
}
