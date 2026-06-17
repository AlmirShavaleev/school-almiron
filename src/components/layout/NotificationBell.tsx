import { useState, useRef, useEffect } from 'react'
import { Bell, Check, CheckCheck, X, Info, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import { cn } from '@/utils/cn'

const TYPE_ICON: Record<Notification['type'], React.ReactNode> = {
  info:    <Info size={14} className="text-blue-500" />,
  success: <CheckCircle2 size={14} className="text-green-500" />,
  warning: <AlertTriangle size={14} className="text-yellow-500" />,
  error:   <AlertCircle size={14} className="text-red-500" />,
}

const TYPE_BG: Record<Notification['type'], string> = {
  info:    'bg-blue-50',
  success: 'bg-green-50',
  warning: 'bg-yellow-50',
  error:   'bg-red-50',
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)  return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`
  return `${Math.floor(diff / 86400)} дн. назад`
}

export function NotificationBell() {
  const { notifications, loading, markAllRead, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.read).length

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
          open ? 'bg-primary-100 text-primary-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        )}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 text-sm">Уведомления</span>
              {unread > 0 && (
                <span className="bg-primary-100 text-primary-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-primary-600 hover:text-primary-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary-50 transition-colors"
                  title="Отметить все как прочитанные"
                >
                  <CheckCheck size={13} />
                  Все прочитано
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-gray-400 text-sm">Загрузка…</div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-10">
                <Bell size={28} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Нет уведомлений</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50',
                    !n.read && TYPE_BG[n.type]
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">{TYPE_ICON[n.type]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('text-sm font-medium text-gray-900 truncate', !n.read && 'font-semibold')}>
                          {n.title}
                        </span>
                        {!n.read && <span className="w-2 h-2 bg-primary-500 rounded-full shrink-0" />}
                      </div>
                      {n.message && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
