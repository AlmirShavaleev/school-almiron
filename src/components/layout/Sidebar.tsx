import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { PREVIEW_ROLE_LABEL, ROLE_LABELS, useStaffMode } from '@/store/staffModeStore'
import { useAuth } from '@/hooks/useAuth'
import { useSidebarBadges } from '@/hooks/useSidebarBadges'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import type { UserRole } from '@/types'
import {
  Home, Users, BookOpen, ClipboardList, CreditCard, Settings,
  GraduationCap, BarChart3, Calendar, Bell, LogOut,
  ChevronRight, ClipboardCheck, X, TrendingUp, ListChecks,
  Send,
  LibraryBig, Shield, Wand2, LifeBuoy, Layers, Images,
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
  { label: 'Прогресс',          path: '/my-progress',    icon: <TrendingUp size={18} />,    roles: ['student'],  section: 'Успехи' },

  { label: 'Уведомления',       path: '/notifications',  icon: <Bell size={18} />,          roles: ['student'],  section: 'Аккаунт' },
  { label: 'Настройки',         path: '/settings',       icon: <Settings size={18} />,      roles: ['student'],  section: 'Аккаунт' },

  // Other roles (flat)
  { label: 'Кабинет учителя',   path: '/teacher',        icon: <GraduationCap size={18} />, roles: ['teacher'] },
  { label: 'Панель админа',     path: '/admin',          icon: <Shield size={18} />,        roles: ['admin', 'owner'] },
  { label: 'Журнал Telegram',   path: '/admin/telegram', icon: <Send size={18} />,          roles: ['admin', 'owner'] },
  { label: 'Обращения',         path: '/admin/support',  icon: <LifeBuoy size={18} />,      roles: ['admin', 'owner'] },
  { label: 'Программа курса',   path: '/course-program', icon: <BookOpen size={18} />,      roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Библиотека уроков', path: '/lesson-library', icon: <LibraryBig size={18} />,    roles: ['teacher', 'admin', 'owner'], hidden: true },
  { label: 'Каталог заданий',   path: '/catalog',        icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  // Рядом с каталогом намеренно: подборка рождается в его корзине, там же её и
  // будут искать. Роли — как у карточки подборки (без куратора), а не как у
  // каталога: пункт меню не должен вести туда, куда RoleGuard не пустит (§188).
  { label: 'Мои подборки',      path: '/collections',    icon: <Layers size={18} />,        roles: ['teacher', 'admin', 'owner'] },
  // Заливка картинок в бакет каталога (§195). Роли ровно те, кому это
  // разрешает политика бакета (`is_admin_or_owner()`): преподавателю пункт не
  // показываем — он бы привёл на экран, где Storage откажет на каждой кнопке.
  { label: 'Картинки каталога', path: '/catalog/assets', icon: <Images size={18} />,        roles: ['admin', 'owner'] },
  { label: 'Проверка ДЗ',       path: '/homework-queue', icon: <ClipboardCheck size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Тесты',             path: '/variants', icon: <ListChecks size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  // «Банк тестов» — отдельная система (topic_tests), тесты в ней привязаны к
  // темам курса. Переименована, чтобы два разных раздела не звались одинаково.
  { label: 'Банк тестов',       path: '/tests', icon: <ListChecks size={18} />, roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Группы',            path: '/groups',         icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'], hidden: true }, // курс = одна группа (§9.1) — раздел скрыт, страница жива по URL
  { label: 'Ученики',           path: '/students',       icon: <Users size={18} />,         roles: ['teacher', 'curator', 'admin', 'owner'] },
  { label: 'Домашние задания',  path: '/homeworks',      icon: <ClipboardList size={18} />, roles: ['teacher', 'curator', 'admin'], hidden: true },
  // §215. Открыт преподавателю, админу и владельцу: экран заработал, когда
  // починили запись результатов. Ученический пункт (выше, раздел «Учёба»)
  // пока закрыт — откроем, когда в таблице появятся настоящие данные.
  { label: 'Пробники',          path: '/mock-exams',     icon: <BookOpen size={18} />,      roles: ['teacher', 'admin', 'owner'] },
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

/**
 * Какой ОДИН пункт меню считать текущим.
 *
 * `NavLink` сам по себе горит на любом пути, который начинается с его адреса,
 * и пункты-вложенцы подсвечиваются парами: на `/catalog/assets` (§195) горели
 * бы и «Картинки каталога», и «Каталог заданий». Подсвеченных пунктов должно
 * быть не больше одного — иначе меню отвечает на вопрос «где я» двумя
 * адресами сразу. Побеждает самый длинный совпавший путь: он и есть тот
 * экран, на котором человек стоит.
 */
function activeNavPath(paths: readonly string[], pathname: string): string | null {
  let best: string | null = null
  for (const p of paths) {
    if (pathname !== p && !pathname.startsWith(p.endsWith('/') ? p : `${p}/`)) continue
    if (best == null || p.length > best.length) best = p
  }
  return best
}

const STAFF_SECTION_LABELS: Array<{ title: string; paths: string[] }> = [
  { title: 'Центр управления', paths: ['/dashboard', '/teacher', '/admin', '/admin/telegram', '/admin/support'] },
  // Занятия, расписание и посещаемость сняты 2026-08-08: владелец ведёт
  // занятия вне платформы, `lessons` и `attendance` пусты по построению.
  // Таблицы не тронуты — если школа начнёт вести занятия внутри, страницы
  // вернутся из истории.
  { title: 'Учебный процесс', paths: ['/groups', '/students', '/course-program', '/lesson-library'] },
  { title: 'Задания', paths: ['/catalog', '/catalog/assets', '/collections', '/homework-queue', '/tests', '/variants', '/student/variants/generate', '/homeworks', '/mock-exams'] },
  { title: 'Операции', paths: ['/notifications', '/settings'] },
]

interface SidebarProps {
  open:    boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const profile = useAuthStore(s => s.profile)
  const { effectiveRole, preview } = useStaffMode()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const badges = useSidebarBadges()
  const curatorships = useMyCuratorships()
  const { pathname } = useLocation()

  if (!profile) return null

  // Меню рисуется РОЛЬЮ ПРЕДСТАВЛЕНИЯ, а не ролью из профиля: у владельца в
  // режиме учителя пропадают админские пункты. Пропали только из меню —
  // маршруты по прямой ссылке живы, их сторожит RoleGuard по настоящей роли.
  // В предпросмотре (§178) роль представления — `student`: те же пункты, что у
  // настоящего ученика; личные страницы из них отвечают заглушкой.
  const menuRole     = effectiveRole ?? profile.role
  const isStudent    = menuRole === 'student'
  const visibleItems = navItems.filter(item => !item.hidden && item.roles.includes(menuRole))
  const activePath   = activeNavPath(
    [...visibleItems, ...(isStudent && curatorships.isCurator ? CURATOR_ITEMS : [])].map(i => i.path),
    pathname,
  )

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
      {/* §225. Меню нового дизайна: тёмно-синий градиент #1a3a80 → #0e1f47,
          активный пункт — жёлтая «таблетка». Раскладка прежняя. */}
      <aside className={cn(
        'fixed left-0 top-0 h-full w-72 md:w-64 bg-gradient-to-b from-menu-top to-menu-bottom text-white flex flex-col z-50',
        'shadow-2xl shadow-primary-950/30',
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
              <div className="text-menu-muted text-xs">School OS</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-full text-menu-muted hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Закрыть меню"
          >
            <X size={18} />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="rounded-2xl bg-white/[0.08] p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white text-primary-950 flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
              {(profile as any).avatar_url
                ? <img src={(profile as any).avatar_url} className="w-full h-full object-cover" alt="" />
                : profile.full_name.charAt(0)
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-sm font-semibold truncate leading-tight">{profile.full_name}</div>
              <div className="text-menu-muted text-xs mt-0.5">{preview ? PREVIEW_ROLE_LABEL : ROLE_LABELS[menuRole] || menuRole}</div>
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
                    <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-menu-muted select-none">
                      {sec.title}
                    </div>
                  )}
                  {sec.items.map(item => (
                    <SidebarNavItem
                      key={item.path}
                      item={item}
                      badge={badges[item.path]}
                      active={item.path === activePath}
                      onClose={onClose}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <StaffNavigation items={visibleItems} badges={badges} activePath={activePath} onClose={onClose} />
          )}
        </nav>

        {/* Sign out */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-full text-sm text-menu-text hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      </aside>
    </>
  )
}

function StaffNavigation({ items, badges, activePath, onClose }: { items: NavItem[]; badges: Record<string, number>; activePath: string | null; onClose: () => void }) {
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
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-menu-muted select-none">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(item => (
              <li key={item.label + item.path}>
                <SidebarNavItem item={item} badge={badges[item.path]} active={item.path === activePath} onClose={onClose} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function SidebarNavItem({ item, badge, active, onClose }: { item: NavItem; badge?: number; active: boolean; onClose: () => void }) {
  return (
    <NavLink
      to={item.path}
      onClick={onClose}
      // §225. Признак текущего пункта — атрибутом, а не только цветом: цвет
      // подсветки меняется с дизайном (была белая плашка, стала жёлтая), а
      // тесты и обход меню опираются на смысл «это текущий экран».
      data-active={active ? 'true' : undefined}
      // Подсветку решает `activeNavPath`, а не сам `NavLink`: его правило
      // «адрес начинается с моего» зажигает сразу два вложенных пункта.
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-full text-sm transition-all group',
        active
          ? 'bg-gold-300 text-graphite-900 font-bold shadow-sm'
          : 'font-medium text-menu-text hover:bg-white/10 hover:text-white'
      )}
    >
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span
          data-testid="nav-badge"
          data-path={item.path}
          // §225. Счётчик-бейдж как в макете: на тёмном меню — светлая
          // полупрозрачная подложка, на жёлтом активном пункте — тёмная.
          className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center leading-4 tabular-nums',
            active ? 'bg-graphite-900/[0.12] text-graphite-900' : 'bg-white/[0.16] text-white',
          )}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      <ChevronRight size={14} className="opacity-0 group-hover:opacity-50 transition-opacity" />
    </NavLink>
  )
}
