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
  ChevronRight, ClipboardCheck, X, TrendingUp, Inbox, ListChecks, FileText,
  Send, ClipboardEdit,
  LibraryBig,
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
  { label: 'Очередь задач',     path: '/inbox',          icon: <Inbox size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },

  // Student navigation (grouped)
  { label: 'Мой кабинет',       path: '/student',        icon: <GraduationCap size={18} />, roles: ['student'],  section: '' },

  { label: 'Мой курс',          path: '/my-course',      icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба' },
  { label: 'Каталог заданий',   path: '/catalog',        icon: <ClipboardList size={18} />, roles: ['student'],  section: 'Учёба' },
  { label: 'Занятия',           path: '/lessons',        icon: <Calendar size={18} />,      roles: ['student'],  section: 'Учёба' },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба' },

  { label: 'Тренировочные варианты', path: '/student/variants', icon: <FileText size={18} />, roles: ['student'], section: 'Учёба' },
  { label: 'Мои задания',       path: '/my-assignments', icon: <ClipboardEdit size={18} />, roles: ['student'],  section: 'Учёба' },
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
  { label: 'Библиотека уроков', path: '/lesson-library', icon: <LibraryBig size={18} />,    roles: ['teacher', 'admin', 'owner'] },
  { label: 'Каталог заданий',   path: '/catalog',        icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Конструктор вариантов', path: '/variants', icon: <ListChecks size={18} />, roles: ['teacher', 'admin', 'owner'] },
  { label: 'Назначение работ',  path: '/assign-homework', icon: <Send size={18} />,     roles: ['teacher', 'admin', 'owner'] },
  { label: 'Проверка работ',    path: '/review-submissions', icon: <ClipboardEdit size={18} />, roles: ['teacher', 'admin', 'owner'] },
  { label: 'Посещаемость',      path: '/attendance',     icon: <ClipboardCheck size={18} />,roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Группы',            path: '/groups',         icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Ученики',           path: '/students',       icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Занятия',           path: '/lessons',        icon: <Calendar size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Расписание',        path: '/schedule',       icon: <Calendar size={18} />,      roles: ['curator', 'admin', 'owner', 'teacher'] },
  { label: 'Домашние задания',  path: '/homeworks',      icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin'] },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['teacher', 'admin', 'owner'] },
  { label: 'Платежи',           path: '/payments',       icon: <CreditCard size={18} />,    roles: ['admin', 'owner'] },
  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
]

const STAFF_SECTION_LABELS: Array<{ title: string; paths: string[] }> = [
  { title: 'Центр управления', paths: ['/dashboard', '/teacher', '/curator', '/admin', '/owner', '/inbox'] },
  { title: 'Учебный процесс', paths: ['/groups', '/students', '/lessons', '/schedule', '/attendance', '/course-program', '/lesson-library'] },
  { title: 'Задания', paths: ['/catalog', '/variants', '/assign-homework', '/review-submissions', '/homeworks', '/mock-exams'] },
  { title: 'Операции', paths: ['/payments', '/notifications', '/settings'] },
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
        'fixed left-0 top-0 h-full w-72 md:w-64 bg-primary-950 text-white flex flex-col z-50',
        'border-r border-white/10 shadow-2xl shadow-primary-950/30',
        'transition-transform duration-300 ease-in-out',
        'md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}>

        {/* Logo + mobile close */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-black/10">
              <GraduationCap size={21} className="text-primary-950" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight tracking-tight">Школа Almiron</div>
              <div className="text-primary-200 text-xs">School OS</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-primary-200 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Закрыть меню"
          >
            <X size={18} />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="rounded-lg bg-white/[0.06] border border-white/10 p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white text-primary-950 flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
              {(profile as any).avatar_url
                ? <img src={(profile as any).avatar_url} className="w-full h-full object-cover" alt="" />
                : profile.full_name.charAt(0)
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-sm font-semibold truncate leading-tight">{profile.full_name}</div>
              <div className="text-primary-200 text-xs mt-0.5">{getRoleLabel(profile.role)}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 overflow-y-auto">
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
            <StaffNavigation items={visibleItems} unreadCount={unreadCount} onClose={onClose} />
          )}
        </nav>

        {/* Sign out */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-primary-100 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      </aside>
    </>
  )
}

function StaffNavigation({ items, unreadCount, onClose }: { items: NavItem[]; unreadCount: number; onClose: () => void }) {
  const used = new Set<string>()
  const sections = STAFF_SECTION_LABELS.map(section => ({
    title: section.title,
    items: items.filter(item => section.paths.includes(item.path) && !used.has(item.path)),
  })).filter(section => {
    section.items.forEach(item => used.add(item.path))
    return section.items.length > 0
  })
  const rest = items.filter(item => !used.has(item.path))
  if (rest.length > 0) sections.push({ title: 'Другое', items: rest })

  return (
    <div className="px-2 space-y-3">
      {sections.map(section => (
        <div key={section.title}>
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary-300/80 select-none">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(item => (
              <li key={item.label + item.path}>
                <SidebarNavItem item={item} unreadCount={unreadCount} onClose={onClose} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function SidebarNavItem({ item, unreadCount, onClose }: { item: NavItem; unreadCount: number; onClose: () => void }) {
  return (
    <NavLink
      to={item.path}
      onClick={onClose}
      className={({ isActive }) => cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group',
        isActive
          ? 'bg-white text-primary-950 shadow-sm'
          : 'text-primary-100/90 hover:bg-white/10 hover:text-white'
      )}
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.path === '/notifications' && unreadCount > 0 && (
        <span className="bg-gold-300 text-primary-950 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
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
