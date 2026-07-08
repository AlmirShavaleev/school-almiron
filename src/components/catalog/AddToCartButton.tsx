import { useState } from 'react'
import { ShoppingCart, Check, X } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'

interface Props {
  taskId:    string
  className?: string
  compact?:  boolean
}

export function AddToCartButton({ taskId, className = '', compact = false }: Props) {
  const { addItem, removeItem, hasItem } = useCartStore()
  const [justAdded, setJustAdded] = useState(false)
  const inCart = hasItem(taskId)

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    const result = addItem(taskId)
    if (result === 'added') {
      setJustAdded(true)
      setTimeout(() => setJustAdded(false), 1500)
    }
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    removeItem(taskId)
  }

  if (inCart) {
    return (
      <button
        onClick={handleRemove}
        title="Убрать из подборки"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
          bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700 transition-colors group ${className}`}
      >
        <Check size={15} className="group-hover:hidden" />
        <X     size={15} className="hidden group-hover:block" />
        {!compact && (
          <span>
            <span className="group-hover:hidden">В подборке</span>
            <span className="hidden group-hover:inline">Убрать</span>
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={handleAdd}
      title="Добавить в подборку"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
        bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors ${
          justAdded ? 'scale-95' : ''
        } ${className}`}
    >
      <ShoppingCart size={15} />
      {!compact && <span>В подборку</span>}
    </button>
  )
}
