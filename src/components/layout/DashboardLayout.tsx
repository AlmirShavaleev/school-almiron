import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { NotificationBell } from './NotificationBell'
import { ImpersonationBanner } from '@/components/demo/ImpersonationBanner'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Menu, Search } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  student:  'Ученик',
  teacher:  'Учитель',
  curator:  'Куратор',
  admin:    'Администратор',
  owner:    'Владелец',
}

const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/student$/, 'Мой кабинет'],
  [/^\/teacher$/, 'Кабинет учителя'],
  [/^\/curator$/, 'Кабинет куратора'],
  [/^\/admin$/, 'Панель админа'],
  [/^\/owner$/, 'Школа'],
  [/^\/groups\/[^/]+$/, 'Панель группы'],
  [/^\/groups$/, 'Группы'],
  [/^\/students\/[^/]+/, 'Профиль ученика'],
  [/^\/inbox$/, 'Очередь задач'],
  [/^\/schedule$/, 'Расписание'],
  [/^\/attendance$/, 'Посещаемость'],
  [/^\/lessons/, 'Занятия'],
  [/^\/homeworks/, 'Домашние задания'],
  [/^\/review-submissions/, 'Проверка работ'],
  [/^\/catalog/, 'Каталог заданий'],
  [/^\/variants/, 'Варианты'],
  [/^\/payments$/, 'Платежи'],
  [/^\/notifications$/, 'Уведомления'],
  [/^\/settings$/, 'Настройки'],
]

export function DashboardLayout() {
  const { profile, loading } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-primary-50/30">
        <div className="platform-surface rounded-lg flex flex-col items-center gap-4 px-8 py-7">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-800 rounded-full animate-spin" />
          <span className="text-slate-500 text-sm font-medium">Загрузка платформы...</span>
        </div>
      </div>
    )
  }

  if (!profile) return null

  const initials = profile.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
    : '?'
  const isFullscreenReviewRoute = /^\/homeworks\/[^/]+\/review(?:\/|$)/.test(location.pathname)
  const pageTitle = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] || 'School OS'

  return (
    <div className="flex min-h-screen bg-transparent text-graphite-900">
      {/* Sidebar — receives open/onClose for mobile drawer behaviour */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content: no left margin on mobile, 256px on md+ */}
      <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
        <ImpersonationBanner />
        {/* Top bar */}
        <header className="h-16 bg-white/82 backdrop-blur-xl border-b border-slate-200/70 flex items-center px-4 md:px-8 gap-3 shrink-0 sticky top-0 z-30">
          {/* Hamburger — visible only on mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-graphite-900 transition-colors shrink-0"
            aria-label="Открыть меню"
          >
            <Menu size={20} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-graphite-950 truncate">{pageTitle}</div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <Search size={12} />
              <span>Быстрый доступ через навигацию слева</span>
            </div>
          </div>

          <NotificationBell />

          {/* Avatar + name */}
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="w-9 h-9 rounded-lg bg-primary-950 flex items-center justify-center text-white font-bold text-xs overflow-hidden shrink-0 shadow-sm shadow-primary-950/15">
              {profile.avatar_url
                ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                : initials
              }
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold text-graphite-950 leading-tight">{profile.full_name || 'Профиль'}</div>
              <div className="text-xs text-slate-500 leading-tight">{ROLE_LABELS[profile.role] || profile.role}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0">
          {/* Adaptive padding: 16px mobile → 24px sm → 32px md+ */}
          <div className={isFullscreenReviewRoute
            ? 'min-w-0 h-[calc(100dvh-3.5rem)] px-0 py-0'
            : 'min-w-0 p-4 sm:p-6 md:p-8 max-w-[1420px] mx-auto'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
