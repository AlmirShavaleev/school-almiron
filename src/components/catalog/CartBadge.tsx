import { ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'

const STAFF = new Set(['teacher', 'admin', 'owner'])

/** Floating cart indicator — shown in catalog pages for staff roles */
export function CartBadge() {
  const profile = useAuthStore(s => s.profile)
  const items   = useCartStore(s => s.items)

  if (!profile || !STAFF.has(profile.role)) return null
  if (items.length === 0) return null

  return (
    <Link
      to="/cart"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5
        bg-blue-600 text-white px-4 py-2.5 rounded-full shadow-lg
        hover:bg-blue-700 transition-colors"
      aria-label={`Подборка — ${items.length} заданий`}
    >
      <ShoppingCart size={18} />
      <span className="text-sm font-medium">Подборка · {items.length}</span>
    </Link>
  )
}
