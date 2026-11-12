import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Timer, X } from 'lucide-react'
import { Mark } from '@/pages/landing/Brand'
import { useStudentNav, type MoreItem } from '@/hooks/useStudentNav'

/** Общий список для мобильного меню и меню профиля. На компьютере ссылки
 * находятся прямо в боковой панели, выход — отдельная кнопка внизу. */
export function MoreList({ items, onDone }: { items: MoreItem[]; onDone: () => void }) {
  const navigate = useNavigate()
  return (
    <ul className="stu-more-list" role="menu">
      {items.map(i => (
        <li key={i.key} role="none">
          <button
            type="button"
            role="menuitem"
            className="stu-more-item stu-focus"
            data-testid={`student-more-${i.key}`}
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

function Badge({ n }: { n?: number | null }) {
  if (!n) return null
  return <span className="stu-nav-dot" aria-label={`${n} к сдаче`}>{n > 99 ? '99+' : n}</span>
}

export function StudentNav() {
  const { main, more } = useStudentNav()
  const { pathname } = useLocation()
  const [sheet, setSheet] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDismiss(sheet, () => setSheet(false), sheetRef)

  const railLinks = more.filter(i => i.to)
  const logout = more.find(i => i.key === 'logout')

  const mobileMain = main.filter(i => i.key !== 'mocks')
  const mobileMore: MoreItem[] = [
    { key: 'mocks', label: 'Пробники', icon: <Timer size={18} aria-hidden />, to: '/my-mock-exams' },
    ...more,
  ]
  const moreActive = /^\/(subscription|my-subscription|courses|settings|my-mock-exams)/.test(pathname)

  return (
    <>
      {/* Компьютер: узкая колонка */}
      <nav className="stu-rail" aria-label="Меню ученика" data-testid="student-rail">
        <span className="stu-rail-logo"><Mark size={34} /></span>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {main.map(i => (
          <NavLink key={i.key} to={i.to} className="stu-rail-item stu-focus" data-active={i.match.test(pathname) || undefined}
            aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`student-nav-${i.key}`}>
            <span className="relative">{i.icon}<Badge n={i.badge} /></span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        {railLinks.map(i => (
          <NavLink key={i.key} to={i.to!} className="stu-rail-item stu-focus"
            data-active={pathname.startsWith(i.to!) || undefined} aria-current={pathname.startsWith(i.to!) ? 'page' : undefined}
            title={i.tag ? `${i.label} · ${i.tag}` : i.label} data-testid={`student-nav-${i.key}`}>
            {i.icon}<span>{i.label}</span>
          </NavLink>
        ))}
        </div>
        {logout && (
          <button type="button" className="stu-rail-item stu-focus w-full shrink-0" onClick={logout.onClick} data-testid="student-nav-logout">
            {logout.icon}<span>Выйти</span>
          </button>
        )}
      </nav>

      {/* Телефон: нижняя панель */}
      <nav className="stu-tabbar" aria-label="Меню ученика" data-testid="student-tabbar">
        {mobileMain.map(i => (
          <NavLink key={i.key} to={i.to} className="stu-tab stu-focus" data-active={i.match.test(pathname) || undefined}
            aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`student-tab-${i.key}`}>
            <span className="relative">{i.icon}<Badge n={i.badge} /></span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        <button type="button" className="stu-tab stu-focus" aria-haspopup="menu" aria-expanded={sheet}
          data-active={moreActive || undefined} onClick={() => setSheet(true)} data-testid="student-tab-more">
          <Menu size={22} aria-hidden /><span>Меню</span>
        </button>
      </nav>
      {sheet && (
        <div className="stu-sheet-scrim" data-testid="student-more-sheet">
          <div className="stu-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Меню">
            <div className="flex items-center justify-between px-2 pb-1">
              <b className="text-[16px]">Меню</b>
              <button type="button" className="stu-icon-btn" aria-label="Закрыть" onClick={() => setSheet(false)}><X size={18} /></button>
            </div>
            <MoreList items={mobileMore} onDone={() => setSheet(false)} />
          </div>
        </div>
      )}
    </>
  )
}

/** Аватар в шапке: по клику — то же «Ещё» (без «Пробников»). */
export function StudentAvatarMenu({ avatar }: { avatar: ReactNode }) {
  const { more } = useStudentNav()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), ref)
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="stu-ava-btn stu-focus" aria-haspopup="menu" aria-expanded={open} aria-label="Профиль и настройки"
        onClick={() => setOpen(o => !o)} data-testid="student-avatar-menu">
        {avatar}
      </button>
      {open && (
        <div className="stu-head-pop" data-testid="student-avatar-pop">
          <MoreList items={more} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
