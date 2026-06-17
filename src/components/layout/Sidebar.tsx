import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/types'
import {
  Home, Users, BookOpen, ClipboardList, CreditCard, Settings,
  GraduationCap, BarChart3, Calendar, CheckSquare, Bell, LogOut,
  ChevronRight, ClipboardCheck, X, TrendingUp,
} from 'lucide-react'

interface NavItem {
  label:   string
  path:    string
  icon:    React.ReactNode
  roles:   UserRole[]
  section?: string
}

const navItems: NavItem[] = [
  // Non-student roles
  { label: 'Главная',           path: '/dashboard',      icon: <Home size={18} />,          roles: ['teacher', 'curator', 'admin', 'owner'] },

  // Student navigation (grouped)
  { label: 'Мой кабинет',       path: '/student',        icon: <GraduationCap size={18} />, roles: ['student'],  section: '' },

  { label: 'Мой курс',          path: '/my-course',      icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба' },
  { label: 'Занятия',           path: '/lessons',        icon: <Calendar size={18} />,      roles: ['student'],  section: 'Учёба' },
  { label: 'Домашние задания',  path: '/homeworks',      icon: <ClipboardList size={18} />, roles: ['student'],  section: 'Учёба' },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба' },

  { label: 'Прогресс',          path: '/my-progress',    icon: <TrendingUp size={18} />,    roles: ['student'],  section: 'Успехи' },

  { label: 'Подписка',          path: '/payments',       icon: <CreditCard size={18} />,    roles: ['student'],  section: 'Аккаунт' },
  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['student'],  section: 'Аккаунт' },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['student'],  section: 'Аккаунт' },

  // Other roles (flat)
  { label: 'Кабинет учителя',   path: '/teacher',        icon: <BookOpen size={18} />,      roles: ['teacher'] },
  { label: 'Кабинет куратора',  path: '/curator',        icon: <CheckSquare size={18} />,   roles: ['curator'] },
  { label: 'Панель админа',     path: '/admin',          icon: <Settings size={18} />,      roles: ['admin', 'owner'] },
  { label: 'Школа',             path: '/owner',          icon: <BarChart3 size={18} />,     roles: ['owner'] },
  { label: 'Программа курса',   path: '/course-program', icon: <BookOpen size={18} />,      roles: ['teacher', 'admin', 'owner'] },
  { label: 'Посещаемость',      path: '/attendance',     icon: <ClipboardCheck size={18} />,roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Группы',            path: '/groups',         icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Занятия',           path: '/lessons',        icon: <Calendar size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Расписание',        path: '/schedule',       icon: <Calendar size={18} />,      roles: ['curator', 'admin', 'owner', 'teacher'] },
  { label: 'Домашние задания',  path: '/homeworks',      icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin'] },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['teacher', 'admin', 'owner'] },
  { label: 'Платежи',           path: '/payments',       icon: <CreditCard size={18} />,    roles: ['admin', 'owner'] },
  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
]

interface SidebarProps {
  open:    boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const profile = useAuthStore(s => s.profile)
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!profile) return
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('read', false)
      .then(({ count }) => setUnreadCount(count || 0))
      .catch(() => {})
  }, [profile])

  if (!profile) return null

  const isStudent    = profile.role === 'student'
  const visibleItems = navItems.filter(item => item.roles.includes(profile.role))

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // Build sections for student
  const studentSections: { title: string; items: NavItem[] }[] = []
  if (isStudent) {
    const seen = new Set<string>()
    for (const item of visibleItems) {
      const sec = item.section ?? ''
      if (!seen.has(sec)) { seen.add(sec); studentSections.push({ title: sec, items: [] }) }
      studentSections.find(s => s.title === sec)!.items.push(item)
    }
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 md:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Sidebar panel */}
      <aside className={cn(
        'fixed left-0 top-0 h-full w-72 md:w-64 bg-slate-900 flex flex-col z-50',
        'transition-transform duration-300 ease-in-out',
        'md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}>

        {/* Logo + mobile close */}
        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center shrink-0">
              <GraduationCap size={20} className="text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight">Школа Almiron</div>
              <div className="text-slate-400 text-xs">ЕГЭ/ОГЭ подготовка</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Закрыть меню"
          >
            <X size={18} />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden">
              {(profile as any).avatar_url
                ? <img src={(profile as any).avatar_url} className="w-full h-full object-cover" alt="" />
                : profile.full_name.charAt(0)
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-sm font-semibold truncate leading-tight">{profile.full_name}</div>
              <div className="text-slate-400 text-xs mt-0.5">{getRoleLabel(profile.role)}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {isStudent ? (
            <div className="px-2 space-y-1">
              {studentSections.map(sec => (
                <div key={sec.title}>
                  {sec.title && (
                    <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 select-none">
                      {sec.title}
                    </div>
                  )}
                  {sec.items.map(item => (
                    <SidebarNavItem
                      key={item.path}
                      item={item}
                      unreadCount={unreadCount}
                      onClose={onClose}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <ul className="space-y-0.5 px-2">
              {visibleItems.map(item => (
                <li key={item.label + item.path}>
                  <SidebarNavItem item={item} unreadCount={unreadCount} onClose={onClose} />
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* Sign out */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      </aside>
    </>
  )
}

function SidebarNavItem({ item, unreadCount, onClose }: { item: NavItem; unreadCount: number; onClose: () => void }) {
  return (
    <NavLink
      to={item.path}
      onClick={onClose}
      className={({ isActive }) => cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors group',
        isActive
          ? 'bg-primary-600 text-white'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      )}
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.path === '/notifications' && unreadCount > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      <ChevronRight size={14} className="opacity-0 group-hover:opacity-50 transition-opacity" />
    </NavLink>
  )
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    student: 'Ученик', teacher: 'Преподаватель',
    curator: 'Куратор', admin: 'Администратор', owner: 'Владелец',
  }
  return labels[role] || role
}
