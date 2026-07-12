import { ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCartStore } from '@/store/cartStore'
import { useAuthStore } from '@/store/authStore'

const STAFF = new Set(['teacher', 'admin', 'owner'])

/** Floating cart indicator — shown in catalog pages. Staff check out into a
 * collection at /cart; students check out into a self-built variant at
 * /student/variants/build. Same underlying cart store either way. */
export function CartBadge() {
  const profile = useAuthStore(s => s.profile)
  const items   = useCartStore(s => s.items)

  if (!profile || (!STAFF.has(profile.role) && profile.role !== 'student')) return null
  if (items.length === 0) return null

  const isStudent = profile.role === 'student'
  const destination = isStudent ? '/student/variants/build' : '/cart'
  const label = isStudent ? 'Мой вариант' : 'Подборка'

  return (
    <Link
      to={destination}
      data-testid="cart-badge"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5
        bg-blue-600 text-white px-4 py-2.5 rounded-full shadow-lg
        hover:bg-blue-700 transition-colors"
      aria-label={`${label} — ${items.length} заданий`}
    >
      <ShoppingCart size={18} />
      <span className="text-sm font-medium">{label} · {items.length}</span>
    </Link>
  )
}
