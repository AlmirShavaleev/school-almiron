import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { NotificationBell } from './NotificationBell'
import { ImpersonationBanner } from '@/components/demo/ImpersonationBanner'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  student:  'Ученик',
  teacher:  'Учитель',
  curator:  'Куратор',
  admin:    'Администратор',
  owner:    'Владелец',
}

export function DashboardLayout() {
  const { profile, loading } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on ESC
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!loading && !profile) navigate('/login')
  }, [profile, loading, navigate])

  // If profile already loaded from cache — render immediately, don't block on loading
  if (!profile && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Загрузка...</span>
        </div>
      </div>
    )
  }

  if (!profile) return null

  const initials = profile.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
    : '?'

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar — receives open/onClose for mobile drawer behaviour */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content: no left margin on mobile, 256px on md+ */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        <ImpersonationBanner />
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-4 md:px-8 gap-3 shrink-0 sticky top-0 z-30">
          {/* Hamburger — visible only on mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors shrink-0"
            aria-label="Открыть меню"
          >
            <Menu size={20} />
          </button>

          {/* Page title spacer */}
          <div className="flex-1" />

          <NotificationBell />

          {/* Avatar + name */}
          <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs overflow-hidden shrink-0">
              {profile.avatar_url
                ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                : initials
              }
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold text-gray-800 leading-tight">{profile.full_name || 'Профиль'}</div>
              <div className="text-xs text-gray-400 leading-tight">{ROLE_LABELS[profile.role] || profile.role}</div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          {/* Adaptive padding: 16px mobile → 24px sm → 32px md+ */}
          <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
