import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Timer, X } from 'lucide-react'
import { Mark } from '@/pages/landing/Brand'
import { useStudentNav, type Item, type MoreItem } from '@/hooks/useStudentNav'
import { STAFF_MORE_PATHS, useStaffNav } from '@/hooks/useStaffNav'
import type { UserRole } from '@/types'

/**
 * Меню кабинета в стиле лендинга: ученик — вариант В (письмо
 * ЛК_стиль_меню_ученика.md, 16.10; макет TdwJzGAuvpGXAFJxvQQ8PM), учитель и
 * админ — тот же каркас (письмо ЛК_учитель_и_админ_редизайн.md, 17.10).
 *  · компьютер — узкая колонка 96px: иконка и подпись под ней, «Ещё» внизу
 *    списка, меню «Ещё» открывается вправо поверх содержимого;
 *  · телефон — нижняя панель (до 4 пунктов + «Ещё»), «Ещё» — лист снизу.
 * Уведомления — колокольчик в шапке; настройки и выход — в «Ещё» и по аватару.
 */
/** Содержимое «Ещё»: список строк. Общий для колонки, листа на телефоне и меню аватара. */
export function MoreList({ items, onDone, prefix = 'student' }: { items: MoreItem[]; onDone: () => void; prefix?: string }) {
  const navigate = useNavigate()
  return (
    <ul className="stu-more-list" role="menu">
      {items.map(i => (
        <li key={i.key} role="none">
          {i.section && <span className="stu-more-sec" role="presentation">{i.section}</span>}
          <button
            type="button"
            role="menuitem"
            className="stu-more-item stu-focus"
            data-testid={`${prefix}-more-${i.key}`}
            onClick={() => { onDone(); if (i.onClick) i.onClick(); else if (i.to) navigate(i.to) }}
          >
            {i.icon}
            <span className="min-w-0 flex-1 truncate text-left">{i.label}</span>
            {i.tag && <span className="stu-more-tag">{i.tag}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Закрыть по клику мимо и Esc. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close, ref])
}

function Badge({ n, label }: { n?: number | null; label: string }) {
  if (!n) return null
  return <span className="stu-nav-dot" aria-label={`${n} ${label}`}>{n > 99 ? '99+' : n}</span>
}

export interface NavSet {
  /** Колонка на компьютере. */
  main: Item[]
  /** «Ещё» на компьютере и по аватару. */
  more: MoreItem[]
  /** Нижняя панель на телефоне (до 4 пунктов; пятый — «Ещё»). */
  mobileMain: Item[]
  /** Лист «Ещё» на телефоне: то, что не влезло в панель, и «Ещё» компьютера. */
  mobileMore: MoreItem[]
  /** Текущий адрес — внутри «Ещё»: подсветить кнопку «Ещё». */
  moreActive: boolean
  /** aria-label меню и префикс data-testid. */
  label: string
  prefix: string
  /** Подпись к числу на значке: «к сдаче», «на проверке». */
  badgeLabel: string
}

/** Каркас меню: колонка + «Ещё» на компьютере, нижняя панель + лист на телефоне. */
export function NavShell({ set }: { set: NavSet }) {
  const { pathname } = useLocation()
  const [railMore, setRailMore] = useState(false)
  const [sheet, setSheet] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDismiss(railMore, () => setRailMore(false), railRef)
  useDismiss(sheet, () => setSheet(false), sheetRef)
  const p = set.prefix
  const railMoreActive = set.moreActive && !set.main.some(i => i.match.test(pathname))

  return (
    <>
      {/* Компьютер: узкая колонка */}
      <nav className="stu-rail" aria-label={set.label} data-testid={`${p}-rail`}>
        <span className="stu-rail-logo"><Mark size={34} /></span>
        {set.main.map(i => (
          <NavLink key={i.key} to={i.to} onClick={() => setRailMore(false)} className="stu-rail-item stu-focus" data-active={i.match.test(pathname) || undefined}
            aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`${p}-nav-${i.key}`}>
            <span className="relative">{i.icon}<Badge n={i.badge} label={set.badgeLabel} /></span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        <div className="relative" ref={railRef}>
          <button type="button" className="stu-rail-item stu-focus w-full" aria-haspopup="menu" aria-expanded={railMore}
            data-active={railMoreActive || undefined}
            onClick={() => setRailMore(o => !o)} data-testid={`${p}-nav-more`}>
            <Menu size={22} aria-hidden /><span>Ещё</span>
          </button>
          {railMore && (
            // Длинное «Ещё» (персонал) — от верха экрана: снизу вверх оно уходило за край.
            <div className={set.more.length > 6 ? 'stu-more-pop is-tall' : 'stu-more-pop'} data-testid={`${p}-more-pop`}>
              <MoreList items={set.more} onDone={() => setRailMore(false)} prefix={p} />
            </div>
          )}
        </div>
      </nav>

      {/* Телефон: нижняя панель */}
      <nav className="stu-tabbar" aria-label={set.label} data-testid={`${p}-tabbar`}>
        {set.mobileMain.map(i => (
          <NavLink key={i.key} to={i.to} className="stu-tab stu-focus" data-active={i.match.test(pathname) || undefined}
            aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`${p}-tab-${i.key}`}>
            <span className="relative">{i.icon}<Badge n={i.badge} label={set.badgeLabel} /></span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        <button type="button" className="stu-tab stu-focus" aria-haspopup="menu" aria-expanded={sheet}
          data-active={set.moreActive && !set.mobileMain.some(i => i.match.test(pathname)) || undefined} onClick={() => setSheet(true)} data-testid={`${p}-tab-more`}>
          <Menu size={22} aria-hidden /><span>Ещё</span>
        </button>
      </nav>
      {sheet && (
        <div className="stu-sheet-scrim" data-testid={`${p}-more-sheet`}>
          <div className="stu-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Ещё">
            <div className="flex items-center justify-between px-2 pb-1">
              <b className="text-[16px]">Ещё</b>
              <button type="button" className="stu-icon-btn" aria-label="Закрыть" onClick={() => setSheet(false)}><X size={18} /></button>
            </div>
            <MoreList items={set.mobileMore} onDone={() => setSheet(false)} prefix={p} />
          </div>
        </div>
      )}
    </>
  )
}

export function StudentNav() {
  const { main, more } = useStudentNav()
  const { pathname } = useLocation()
  return (
    <NavShell set={{
      main,
      more,
      mobileMain: main.filter(i => i.key !== 'mocks'),
      mobileMore: [{ key: 'mocks', label: 'Пробники', icon: <Timer size={18} aria-hidden />, to: '/my-mock-exams' }, ...more],
      moreActive: /^\/(subscription|settings|my-mock-exams)/.test(pathname),
      label: 'Меню ученика',
      prefix: 'student',
      badgeLabel: 'к сдаче',
    }} />
  )
}

/** Аватар в шапке: по клику — то же «Ещё». */
export function AvatarMenu({ avatar, items, prefix = 'student' }: { avatar: ReactNode; items: MoreItem[]; prefix?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="stu-ava-btn stu-focus" aria-haspopup="menu" aria-expanded={open} aria-label="Профиль и настройки"
        onClick={() => setOpen(o => !o)} data-testid={`${prefix}-avatar-menu`}>
        {avatar}
      </button>
      {open && (
        <div className="stu-head-pop" data-testid={`${prefix}-avatar-pop`}>
          <MoreList items={items} onDone={() => setOpen(false)} prefix={prefix} />
        </div>
      )}
    </div>
  )
}

/** Аватар ученика (без «Пробников»). */
export function StudentAvatarMenu({ avatar }: { avatar: ReactNode }) {
  const { more } = useStudentNav()
  return <AvatarMenu avatar={avatar} items={more} prefix="student" />
}

/**
 * Меню учителя и админа (письмо 17.10): тот же каркас. Телефон — 4 пункта
 * (Главная · Проверка · Курсы · Банк) и «Ещё»; «Ученики» и «Админ» — в листе.
 */
const STAFF_TABBAR = ['home', 'review', 'courses', 'bank']

export function StaffNav({ role }: { role: UserRole }) {
  const { main, more } = useStaffNav(role)
  const { pathname } = useLocation()
  return (
    <NavShell set={{
      main,
      more,
      mobileMain: main.filter(i => STAFF_TABBAR.includes(i.key)),
      mobileMore: [
        ...main.filter(i => !STAFF_TABBAR.includes(i.key)).map(i => ({ key: i.key, label: i.label, icon: i.icon, to: i.to })),
        ...more,
      ],
      moreActive: STAFF_MORE_PATHS.test(pathname) || main.some(i => !STAFF_TABBAR.includes(i.key) && i.match.test(pathname)),
      label: 'Меню кабинета',
      prefix: 'staff',
      badgeLabel: 'на проверке',
    }} />
  )
}

/** Аватар персонала: по клику — «Ещё» кабинета. */
export function StaffAvatarMenu({ avatar, role }: { avatar: ReactNode; role: UserRole }) {
  const { more } = useStaffNav(role)
  return <AvatarMenu avatar={avatar} items={more} prefix="staff" />
}
