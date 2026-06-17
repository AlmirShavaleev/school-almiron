import { Check } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useNotifications } from '@/hooks/useNotifications'
import { cn } from '@/utils/cn'

const typeColors: Record<string, string> = {
  info:    'bg-blue-50 border-blue-200',
  success: 'bg-green-50 border-green-200',
  warning: 'bg-yellow-50 border-yellow-200',
  error:   'bg-red-50 border-red-200',
}

const typeIcons: Record<string, string> = {
  info: '📘', success: '✅', warning: '⚠️', error: '🚨',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин. назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч. назад`
  const d = Math.floor(h / 24)
  return `${d} дн. назад`
}

export function NotificationsPage() {
  const { notifications, loading, markAllRead, markRead } = useNotifications()
  const unread = notifications.filter(n => !n.read).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Загрузка…
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Уведомления</h1>
          <p className="text-gray-500 mt-1">
            {unread > 0 ? `${unread} непрочитанных` : 'Всё прочитано'}
          </p>
        </div>
        {unread > 0 && (
          <Button size="sm" variant="secondary" onClick={markAllRead}>
            <Check size={14} className="mr-1" />Прочитать все
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Все уведомления</CardTitle>
          {unread > 0 && <Badge variant="error">{unread} новых</Badge>}
        </CardHeader>

        {notifications.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Нет уведомлений</p>
        ) : (
          <div className="space-y-3">
            {notifications.map(n => (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={cn(
                  'p-4 rounded-xl border transition-all cursor-pointer',
                  typeColors[n.type] || typeColors.info,
                  !n.read && 'ring-2 ring-primary-200'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="text-xl shrink-0">{typeIcons[n.type] || '📌'}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900">{n.title}</span>
                      {!n.read && <span className="w-2 h-2 bg-primary-500 rounded-full" />}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                    <span className="text-xs text-gray-400 mt-1 block">{timeAgo(n.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
