import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router-dom'
import { Ellipsis, Menu, X } from 'lucide-react'
import { Mark } from '@/pages/landing/Brand'
import { useStudentNav, type MoreItem } from '@/hooks/useStudentNav'

function MoreList({ items, onDone, navigation }: { items: MoreItem[]; onDone: () => void; navigation?: boolean }) {
  const itemRole = navigation ? undefined : 'menuitem'
  const itemClass = 'stu-more-item stu-focus'
  return (
    <ul className="stu-more-list" role={navigation ? undefined : 'menu'}>
      {items.map(item => {
        const body = <>
          {item.icon}
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
          {item.tag && <span className="stu-more-tag">{item.tag}</span>}
        </>
        const testId = `student-more-${item.key}`
        return (
          <li key={item.key} role={navigation ? undefined : 'none'}>
            {item.to
              ? <NavLink to={item.to} role={itemRole} className={itemClass} data-testid={testId} onClick={onDone}>{body}</NavLink>
              : <button type="button" role={itemRole} className={itemClass} data-testid={testId}
                  onClick={() => { onDone(); item.onClick?.() }}>{body}</button>}
          </li>
        )
      })}
    </ul>
  )
}

/** Закрыть по клику мимо и Esc. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>, trigger?: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        trigger?.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close, ref, trigger])
}

function Badge({ n }: { n?: number | null }) {
  if (!n) return null
  return <span className="stu-nav-dot" aria-label={`${n} к сдаче`}>{n > 99 ? '99+' : n}</span>
}

export function StudentNav() {
  const { main, more } = useStudentNav()
  const { pathname } = useLocation()
  const [railOpen, setRailOpen] = useState(false)
  const railMoreRef = useRef<HTMLDivElement>(null)
  const railTrigger = useRef<HTMLButtonElement>(null)
  const railMoreId = useId()
  const [sheet, setSheet] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDismiss(railOpen, () => setRailOpen(false), railMoreRef, railTrigger)
  useDismiss(sheet, () => setSheet(false), sheetRef)

  const workPlan = more.find(i => i.key === 'work-plan')
  const railMore = more.filter(i => i.to && i.key !== 'work-plan')
  const railMoreActive = railMore.some(i => i.to && matchPath({ path: i.to, end: false }, pathname))
  const logout = more.find(i => i.key === 'logout')

  const mobileMain = main.filter(i => i.key !== 'mocks')
  const mobileMore = [...main.filter(i => i.key === 'mocks'), ...more]
  const mobileMoreActive = mobileMore.some(i => i.to && matchPath({ path: i.to, end: false }, pathname))

  return (
    <>
      {/* Компьютер: узкая колонка */}
      <nav className="stu-rail" aria-label="Меню ученика" data-testid="student-rail">
        <span className="stu-rail-logo"><Mark size={34} /></span>
        <div className="stu-rail-links">
          {main.map(i => (
            <NavLink key={i.key} to={i.to} className="stu-rail-item stu-focus" data-active={i.match.test(pathname) || undefined}
              aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`student-nav-${i.key}`}>
              <span className="relative">{i.icon}<Badge n={i.badge} /></span>
              <span>{i.label}</span>
            </NavLink>
          ))}
          {workPlan?.to && (
            <NavLink to={workPlan.to} className="stu-rail-item stu-focus" aria-label={workPlan.label} title={workPlan.label}
              data-testid="student-nav-work-plan">
              {workPlan.icon}<span>Мой план</span>
            </NavLink>
          )}
          <div ref={railMoreRef} className="relative" onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) setRailOpen(false)
          }}>
            <button ref={railTrigger} type="button" className="stu-rail-item stu-focus" aria-expanded={railOpen}
              aria-controls={railOpen ? railMoreId : undefined} data-active={railMoreActive || railOpen || undefined}
              onClick={() => setRailOpen(open => !open)} data-testid="student-nav-more">
              <Ellipsis size={22} aria-hidden /><span>Ещё</span>
            </button>
            {railOpen && (
              <div className="stu-more-pop" id={railMoreId} data-testid="student-rail-more">
                <MoreList items={railMore} onDone={() => setRailOpen(false)} navigation />
              </div>
            )}
          </div>
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
          data-active={mobileMoreActive || undefined} onClick={() => setSheet(true)} data-testid="student-tab-more">
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
