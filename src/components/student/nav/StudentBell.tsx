import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'

/**
 * Колокольчик ученика в шапке (письмо ЛК_стиль_меню_ученика.md, 16.10): число
 * непрочитанных, по клику — последние уведомления и «Все уведомления» → прежняя
 * страница `/notifications`. Пункт «Уведомления» из меню убран.
 */
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`
  return `${Math.floor(s / 86400)} дн назад`
}

export function StudentBell() {
  const { notifications, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const unread = notifications.filter(n => !n.read).length
  const latest = notifications.slice(0, 6)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="stu-icon-btn relative" aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Уведомления: ${unread} непрочитанных` : 'Уведомления'}
        onClick={() => setOpen(o => !o)} data-testid="student-bell">
        <Bell size={19} aria-hidden />
        {unread > 0 && <span className="stu-bell-dot" data-testid="student-bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="stu-head-pop stu-bell-pop" role="dialog" aria-label="Уведомления" data-testid="student-bell-pop">
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <b className="text-[15px]">Уведомления</b>
            {unread > 0 && <button type="button" className="stu-link text-[13px]" onClick={() => void markAllRead()}>Прочитать все</button>}
          </div>
          {latest.length === 0 ? (
            <p className="stu-muted px-2 py-3 text-[14px]">Пока ничего нового.</p>
          ) : (
            <ul className="stu-bell-list">
              {latest.map(n => (
                <li key={n.id}>
                  <button type="button" className={n.read ? 'stu-bell-item' : 'stu-bell-item is-new'}
                    onClick={() => { if (!n.read) void markRead(n.id); if (n.link) { setOpen(false); navigate(n.link) } }}>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[14px] font-semibold">{n.title}</span>
                      <span className="stu-muted line-clamp-2 block text-[13px]">{n.message}</span>
                    </span>
                    <span className="stu-muted shrink-0 text-[12px]">{ago(n.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notifications" className="stu-bell-all" onClick={() => setOpen(false)} data-testid="student-bell-all">Все уведомления</Link>
        </div>
      )}
    </div>
  )
}
