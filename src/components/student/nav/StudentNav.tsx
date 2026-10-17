import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Timer, X } from 'lucide-react'
import { Mark } from '@/pages/landing/Brand'
import { useStudentNav, type MoreItem } from '@/hooks/useStudentNav'

/**
 * Меню ученика, вариант В (письмо ЛК_стиль_меню_ученика.md, 16.10; макет
 * TdwJzGAuvpGXAFJxvQQ8PM): 5 пунктов + «Ещё».
 *  · компьютер — узкая колонка 96px: иконка и подпись под ней, «Ещё» внизу
 *    списка, меню «Ещё» открывается вправо поверх содержимого;
 *  · телефон — нижняя панель на 5 мест (Главная · Курсы · ДЗ · Банк · Ещё),
 *    «Ещё» — лист снизу; «Пробники» — там.
 * Уведомления — колокольчик в шапке; настройки и выход — в «Ещё» и по аватару.
 * Только навигация: разделы и данные не меняются. Кабинет преподавателя — свой.
 */
/** Содержимое «Ещё»: список строк. Общий для колонки, листа на телефоне и меню аватара. */
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
  const [railMore, setRailMore] = useState(false)
  const [sheet, setSheet] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDismiss(railMore, () => setRailMore(false), railRef)
  useDismiss(sheet, () => setSheet(false), sheetRef)

  const mobileMain = main.filter(i => i.key !== 'mocks')
  const mobileMore: MoreItem[] = [
    { key: 'mocks', label: 'Пробники', icon: <Timer size={18} aria-hidden />, to: '/my-mock-exams' },
    ...more,
  ]
  const moreActive = /^\/(subscription|settings|my-mock-exams)/.test(pathname)

  return (
    <>
      {/* Компьютер: узкая колонка */}
      <nav className="stu-rail" aria-label="Меню ученика" data-testid="student-rail">
        <span className="stu-rail-logo"><Mark size={34} /></span>
        {main.map(i => (
          <NavLink key={i.key} to={i.to} onClick={() => setRailMore(false)} className="stu-rail-item stu-focus" data-active={i.match.test(pathname) || undefined}
            aria-current={i.match.test(pathname) ? 'page' : undefined} data-testid={`student-nav-${i.key}`}>
            <span className="relative">{i.icon}<Badge n={i.badge} /></span>
            <span>{i.label}</span>
          </NavLink>
        ))}
        <div className="relative" ref={railRef}>
          <button type="button" className="stu-rail-item stu-focus w-full" aria-haspopup="menu" aria-expanded={railMore}
            data-active={moreActive && !/^\/my-mock-exams/.test(pathname) || undefined}
            onClick={() => setRailMore(o => !o)} data-testid="student-nav-more">
            <Menu size={22} aria-hidden /><span>Ещё</span>
          </button>
          {railMore && (
            <div className="stu-more-pop" data-testid="student-more-pop">
              <MoreList items={more} onDone={() => setRailMore(false)} />
            </div>
          )}
        </div>
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
          <Menu size={22} aria-hidden /><span>Ещё</span>
        </button>
      </nav>
      {sheet && (
        <div className="stu-sheet-scrim" data-testid="student-more-sheet">
          <div className="stu-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Ещё">
            <div className="flex items-center justify-between px-2 pb-1">
              <b className="text-[16px]">Ещё</b>
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
