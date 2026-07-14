import { useState } from 'react'
import { ShoppingCart, Check, X } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'

interface Props {
  taskId:    string
  className?: string
  compact?:  boolean
}

export function AddToCartButton({ taskId, className = '', compact = false }: Props) {
  const addItem = useCartStore(s => s.addItem)
  const removeItem = useCartStore(s => s.removeItem)
  const inCart = useCartStore(s => s.items.some(item => item.catalog_task_id === taskId))
  const [justAdded, setJustAdded] = useState(false)

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
        className={`inline-flex min-h-10 items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
          bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80
          hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-200
          transition-[background-color,color,box-shadow,transform] duration-200
          active:scale-[0.96] group ${className}`}
      >
        <span className="relative h-4 w-4 shrink-0">
          <Check
            size={15}
            className="absolute inset-0 scale-100 opacity-100 blur-0 transition-[transform,opacity,filter] duration-200 ease-out group-hover:scale-[0.25] group-hover:opacity-0 group-hover:blur-sm"
          />
          <X
            size={15}
            className="absolute inset-0 scale-[0.25] opacity-0 blur-sm transition-[transform,opacity,filter] duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:blur-0"
          />
        </span>
        {!compact && (
          <span className="tabular-nums">
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
      className={`inline-flex min-h-10 items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium
        bg-blue-50 text-blue-700 ring-1 ring-blue-200/80 hover:bg-blue-100
        transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.96] ${
          justAdded ? 'scale-[0.96]' : ''
        } ${className}`}
    >
      <ShoppingCart size={15} />
      {!compact && <span className="tabular-nums">В подборку</span>}
    </button>
  )
}
