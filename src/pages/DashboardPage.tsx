import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useStaffMode } from '@/store/staffModeStore'

// Redirects to the role-specific dashboard
export function DashboardPage() {
  const profile = useAuthStore(s => s.profile)
  // Владелец в режиме учителя попадает в кабинет учителя, а не в панель
  // админа. Это представление: сам маршрут /admin остаётся ему доступен.
  const { effectiveRole } = useStaffMode()
  const navigate = useNavigate()

  useEffect(() => {
    if (!profile) return
    const routes: Record<string, string> = {
      student: '/student',
      teacher: '/teacher',
      curator: '/curator',
      admin: '/admin',
      // Маршрута /owner больше нет (снесён 2026-08-04: роли owner нет ни у
      // одного профиля, а внутри был денежный дашборд поверх пустой таблицы).
      owner: '/admin',
    }
    navigate(routes[effectiveRole ?? profile.role] || '/student', { replace: true })
  }, [profile, effectiveRole, navigate])

  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
