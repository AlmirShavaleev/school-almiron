import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

// Redirects to the role-specific dashboard
export function DashboardPage() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  useEffect(() => {
    if (!profile) return
    const routes: Record<string, string> = {
      student: '/student',
      teacher: '/teacher',
      curator: '/curator',
      admin: '/admin',
      owner: '/owner',
    }
    navigate(routes[profile.role] || '/student', { replace: true })
  }, [profile, navigate])

  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
