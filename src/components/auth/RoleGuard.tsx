import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

/**
 * Защита маршрута по роли. Роль берётся ТОЛЬКО из загруженного из БД профиля.
 * Если роль не входит в allow — редирект на собственный дашборд пользователя.
 */
export function RoleGuard({ allow, children }: { allow: UserRole[]; children: ReactNode }) {
  const profile = useAuthStore(s => s.profile)
  const loading = useAuthStore(s => s.loading)

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!profile) return <Navigate to="/login" replace />
  if (!allow.includes(profile.role)) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
