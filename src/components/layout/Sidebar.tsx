import { NavLink, useNavigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS, useStaffMode } from '@/store/staffModeStore'
import { useAuth } from '@/hooks/useAuth'
import { useSidebarBadges } from '@/hooks/useSidebarBadges'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import type { UserRole } from '@/types'
import {
  Home, Users, BookOpen, ClipboardList, CreditCard, Settings,
  GraduationCap, BarChart3, Calendar, Bell, LogOut,
  ChevronRight, ClipboardCheck, X, TrendingUp, Inbox, ListChecks,
  Send, ClipboardEdit,
  LibraryBig, Shield, Wand2,
} from 'lucide-react'

interface NavItem {
  label:   string
  path:    string
  icon:    React.ReactNode
  roles:   UserRole[]
  section?: string
  /**
   * Легаси-раздел, скрытый из навигации на время MVP (карта сноса —
   * PROJECT_STATE §4). Страница и роут остаются рабочими по прямой ссылке;
   * чтобы вернуть пункт в меню, удалите флаг.
   */
  hidden?: boolean
}

const navItems: NavItem[] = [
  // Non-student roles
  { label: 'Главная',           path: '/dashboard',      icon: <Home size={18} />,          roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Очередь задач',     path: '/inbox',          icon: <Inbox size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'], hidden: true },

  // Student navigation (grouped)
  { label: 'Мой кабинет',       path: '/student',        icon: <GraduationCap size={18} />, roles: ['student'],  section: '' },

  { label: 'Мой курс',          path: '/my-course',      icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба' },
  { label: 'Домашние задания',  path: '/my-homework',    icon: <ClipboardCheck size={18} />, roles: ['student'], section: 'Учёба' },
  { label: 'Каталог заданий',   path: '/catalog',        icon: <ClipboardList size={18} />, roles: ['student'],  section: 'Учёба' },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['student'],  section: 'Учёба', hidden: true },

  // Путь ученика к самостоятельной сборке был достижим только по прямой ссылке:
  // пункт стоял скрытым, а ссылка на конструктор жила на самой скрытой странице.
  // Отсюда и ноль самостоятельно собранных вариантов на проде за всё время.
  //
  // Пункт один: вход — конструктор, список собранных вариантов открывается
  // изнутри него по ссылке «К вариантам». Два пункта на один раздел только
  // множили выбор там, где его нет.
  { label: 'Конструктор вариантов', path: '/student/variants/generate', icon: <Wand2 size={18} />, roles: ['student'], section: 'Учёба' },
  // Тот же экран у персонала — вход из «Заданий», рядом с «Тестами». Сохраняет
  // обычный вариант, а не самоназначение (§128).
  { label: 'Конструктор вариантов', path: '/student/variants/generate', icon: <Wand2 size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Мои задания',       path: '/my-assignments', icon: <ClipboardEdit size={18} />, roles: ['student'],  section: 'Учёба', hidden: true },
  { label: 'Прогресс',          path: '/my-progress',    icon: <TrendingUp size={18} />,    roles: ['student'],  section: 'Успехи' },

  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['student'],  section: 'Аккаунт' },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['student'],  section: 'Аккаунт' },

  // Other roles (flat)
  { label: 'Кабинет учителя',   path: '/teacher',        icon: <GraduationCap size={18} />, roles: ['teacher'] },
  { label: 'Панель админа',     path: '/admin',          icon: <Shield size={18} />,        roles: ['admin', 'owner'] },
  { label: 'Журнал Telegram',   path: '/admin/telegram', icon: <Send size={18} />,          roles: ['admin', 'owner'] },
  { label: 'Программа курса',   path: '/course-program', icon: <BookOpen size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Библиотека уроков', path: '/lesson-library', icon: <LibraryBig size={18} />,    roles: ['teacher', 'admin', 'owner'], hidden: true },
  { label: 'Каталог заданий',   path: '/catalog',        icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Проверка ДЗ',       path: '/homework-queue', icon: <ClipboardCheck size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Тесты',             path: '/variants', icon: <ListChecks size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  // «Банк тестов» — отдельная система (topic_tests), тесты в ней привязаны к
  // темам курса. Переименована, чтобы два разных раздела не звались одинаково.
  { label: 'Банк тестов',       path: '/tests', icon: <ListChecks size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Назначение работ',  path: '/assign-homework', icon: <Send size={18} />,     roles: ['teacher', 'admin', 'owner'], hidden: true },
  { label: 'Проверка работ',    path: '/review-submissions', icon: <ClipboardEdit size={18} />, roles: ['teacher', 'admin', 'owner'], hidden: true },
  { label: 'Группы',            path: '/groups',         icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'], hidden: true }, // курс = одна группа (§9.1) — раздел скрыт, страница жива по URL
  { label: 'Ученики',           path: '/students',       icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Домашние задания',  path: '/homeworks',      icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin'], hidden: true },
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['teacher', 'admin', 'owner'], hidden: true },
  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
]

/**
 * Вход в кураторство для того, кто по профилю остаётся учеником.
 *
 * Кураторство с 2026-08-05 — назначение поверх аккаунта, а не роль, поэтому
 * пункты нельзя раздать через `roles`: у человека там `student`. Это и НЕ
 * учительский кабинет — куратор проверяет ДЗ и смотрит, а не ведёт курс
 * (решение владельца: без правки программы, открытия тем и выдачи тестов).
 *
 * Пути те же, что у преподавателя: страницы общие, разное на них показывает
 * RLS и сужение `useMyTeachingScope`.
 */
const CURATOR_ITEMS: NavItem[] = [
  { label: 'Проверка ДЗ',     path: '/homework-queue', icon: <ClipboardCheck size={18} />, roles: [], section: 'Курирую' },
  { label: 'Программа курса', path: '/course-program', icon: <BookOpen size={18} />,       roles: [], section: 'Курирую' },
  { label: 'Ученики',         path: '/students',       icon: <Users size={18} />,          roles: [], section: 'Курирую' },
]

const STAFF_SECTION_LABELS: Array<{ title: string; paths: string[] }> = [
  { title: 'Центр управления', paths: ['/dashboard', '/teacher', '/admin', '/admin/telegram', '/inbox'] },
  // Занятия, расписание и посещаемость сняты 2026-08-08: владелец ведёт
  // занятия вне платформы, `lessons` и `attendance` пусты по построению.
  // Таблицы не тронуты — если школа начнёт вести занятия внутри, страницы
  // вернутся из истории.
  { title: 'Учебный процесс', paths: ['/groups', '/students', '/course-program', '/lesson-library'] },
  { title: 'Задания', paths: ['/catalog', '/homework-queue', '/tests', '/variants', '/student/variants/generate', '/assign-homework', '/review-submissions', '/homeworks', '/mock-exams'] },
  { title: 'Операции', paths: ['/notifications', '/settings'] },
]

interface SidebarProps {
  open:    boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const profile = useAuthStore(s => s.profile)
  const { effectiveRole } = useStaffMode()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const badges = useSidebarBadges()
  const curatorships = useMyCuratorships()

  if (!profile) return null

  // Меню рисуется РОЛЬЮ ПРЕДСТАВЛЕНИЯ, а не ролью из профиля: у владельца в
  // режиме учителя пропадают админские пункты. Пропали только из меню —
  // маршруты по прямой ссылке живы, их сторожит RoleGuard по настоящей роли.
  const menuRole     = effectiveRole ?? profile.role
  const isStudent    = menuRole === 'student'
  const visibleItems = navItems.filter(item => !item.hidden && item.roles.includes(menuRole))

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
    // «Курирую» — перед «Аккаунтом»: это учебный раздел, а не настройки.
    if (curatorships.isCurator) {
      const before = studentSections.findIndex(s => s.title === 'Аккаунт')
      const section = { title: 'Курирую', items: CURATOR_ITEMS }
      if (before === -1) studentSections.push(section)
      else studentSections.splice(before, 0, section)
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
              <div className="text-primary-200 text-xs mt-0.5">{ROLE_LABELS[menuRole] || menuRole}</div>
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
                    <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-primary-300/80 select-none">
                      {sec.title}
                    </div>
                  )}
                  {sec.items.map(item => (
                    <SidebarNavItem
                      key={item.path}
                      item={item}
                      badge={badges[item.path]}
                      onClose={onClose}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <StaffNavigation items={visibleItems} badges={badges} onClose={onClose} />
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

function StaffNavigation({ items, badges, onClose }: { items: NavItem[]; badges: Record<string, number>; onClose: () => void }) {
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
                <SidebarNavItem item={item} badge={badges[item.path]} onClose={onClose} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function SidebarNavItem({ item, badge, onClose }: { item: NavItem; badge?: number; onClose: () => void }) {
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
      {badge != null && badge > 0 && (
        <span
          data-testid="nav-badge"
          data-path={item.path}
          className="bg-gold-300 text-primary-950 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      <ChevronRight size={14} className="opacity-0 group-hover:opacity-50 transition-opacity" />
    </NavLink>
  )
}
