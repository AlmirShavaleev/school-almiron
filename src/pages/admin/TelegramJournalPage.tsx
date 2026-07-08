import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Send, Filter, RotateCcw, Loader2, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { format, subDays, startOfDay } from 'date-fns'
import { ru } from 'date-fns/locale'

type QueueStatus  = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'all'
type EventFilter  = 'all' | 'new_homework' | 'lesson_reminder' | 'homework_reviewed' | 'lesson_rescheduled' | 'lesson_cancelled' | 'variant_assigned' | 'variant_deadline_changed'
type PeriodFilter = '1d' | '7d' | '30d' | 'all'

interface JournalRow {
  id:                string
  profile_id:        string
  channel:           string
  event_type:        string
  deduplication_key: string
  status:            string
  attempts:          number
  retry_count:       number
  scheduled_for:     string
  sent_at:           string | null
  last_error:        string | null
  created_at:        string
  profiles: { full_name: string; email: string } | null
}

interface Stats {
  pending:    number
  processing: number
  sent:       number
  failed:     number
  cancelled:  number
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Ожидает',    cls: 'bg-yellow-100 text-yellow-800' },
  processing: { label: 'Отправка',   cls: 'bg-blue-100 text-blue-800'    },
  sent:       { label: 'Доставлено', cls: 'bg-green-100 text-green-800'  },
  failed:     { label: 'Ошибка',     cls: 'bg-red-100 text-red-800'      },
  cancelled:  { label: 'Отменено',   cls: 'bg-gray-100 text-gray-600'    },
}

const EVENT_LABELS: Record<string, string> = {
  new_homework:       'Новое ДЗ',
  lesson_reminder:    'Напоминание',
  lesson_rescheduled: 'Перенос',
  lesson_cancelled:   'Отмена занятия',
  homework_reviewed:  'Проверка ДЗ',
  variant_assigned:   'Новый вариант',
  variant_deadline_changed: 'Дедлайн варианта',
}

const STATUS_FILTERS: { key: QueueStatus; label: string }[] = [
  { key: 'all',       label: 'Все'       },
  { key: 'pending',   label: 'Ожидают'   },
  { key: 'sent',      label: 'Доставлены'},
  { key: 'failed',    label: 'Ошибки'    },
  { key: 'cancelled', label: 'Отменены'  },
]

const EVENT_FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all',                label: 'Все'        },
  { key: 'new_homework',       label: 'Новое ДЗ'   },
  { key: 'lesson_reminder',    label: 'Напоминания'},
  { key: 'homework_reviewed',  label: 'Проверка ДЗ'},
  { key: 'lesson_rescheduled', label: 'Перенос'    },
  { key: 'lesson_cancelled',   label: 'Отмена'     },
  { key: 'variant_assigned',   label: 'Вариант'    },
  { key: 'variant_deadline_changed', label: 'Дедлайн варианта' },
]

const PERIOD_FILTERS: { key: PeriodFilter; label: string }[] = [
  { key: '1d',  label: 'Сегодня'  },
  { key: '7d',  label: '7 дней'   },
  { key: '30d', label: '30 дней'  },
  { key: 'all', label: 'Всё время'},
]

function periodStart(period: PeriodFilter): string | null {
  if (period === 'all') return null
  const days = period === '1d' ? 0 : period === '7d' ? 7 : 30
  return startOfDay(subDays(new Date(), days)).toISOString()
}

export function TelegramJournalPage() {
  const [rows,       setRows]       = useState<JournalRow[]>([])
  const [stats,      setStats]      = useState<Stats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [retrying,   setRetrying]   = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [status,     setStatus]     = useState<QueueStatus>('all')
  const [event,      setEvent]      = useState<EventFilter>('all')
  const [period,     setPeriod]     = useState<PeriodFilter>('7d')

  const load = useCallback(async () => {
    setLoading(true)
    setRetryError(null)
    const since = periodStart(period)

    // Строки таблицы
    let q = supabase
      .from('notification_queue')
      .select(`
        id, profile_id, channel, event_type, deduplication_key,
        status, attempts, retry_count, scheduled_for, sent_at, last_error, created_at,
        profiles!notification_queue_profile_id_fkey(full_name, email)
      `, { count: 'exact' })

    if (status !== 'all') q = q.eq('status', status)
    if (event  !== 'all') q = q.eq('event_type', event)
    if (since)            q = q.gte('created_at', since)

    const { data, count, error } = await q
      .order('created_at', { ascending: false })
      .limit(100)

    if (!error) {
      setRows((data ?? []) as unknown as JournalRow[])
      setTotalCount(count ?? 0)
    }

    // Сводка по статусам (параллельно)
    const statuses: Array<keyof Stats> = ['pending', 'processing', 'sent', 'failed', 'cancelled']
    const counts = await Promise.all(
      statuses.map(async s => {
        let sq = supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', s)
        if (since) sq = sq.gte('created_at', since)
        const { count: c } = await sq
        return [s, c ?? 0] as const
      })
    )
    setStats(Object.fromEntries(counts) as unknown as Stats)

    setLoading(false)
  }, [status, event, period])

  useEffect(() => { load() }, [load])

  async function handleRetry(id: string) {
    setRetrying(id)
    setRetryError(null)
    const { error } = await supabase.rpc('retry_notification', { queue_id: id })
    if (error) {
      setRetryError(error.message)
    } else {
      setRows(prev => prev.map(r =>
        r.id === id
          ? { ...r, status: 'pending', attempts: 0, retry_count: r.retry_count + 1 }
          : r
      ))
    }
    setRetrying(null)
  }

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Шапка */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Send size={20} />Журнал Telegram-уведомлений
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalCount > 0 ? `${totalCount} записей` : 'Нет записей'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <RefreshCw size={14} className="mr-1.5" />Обновить
        </Button>
      </div>

      {/* Сводка */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {(Object.entries(stats) as [keyof Stats, number][]).map(([s, n]) => (
            <button
              key={s}
              onClick={() => setStatus(s as QueueStatus)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all',
                status === s
                  ? 'ring-2 ring-primary-500 border-primary-300'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              )}
            >
              <div className="text-2xl font-bold text-gray-900">{n}</div>
              <div className={cn(
                'text-xs font-medium mt-0.5',
                s === 'failed'     ? 'text-red-600'    :
                s === 'sent'       ? 'text-green-600'  :
                s === 'pending'    ? 'text-yellow-700' :
                s === 'processing' ? 'text-blue-600'   :
                'text-gray-500'
              )}>
                {STATUS_LABELS[s]?.label ?? s}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Фильтры */}
      <div className="space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {PERIOD_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setPeriod(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                period === f.key
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          <Filter size={13} className="text-gray-400" />
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                status === f.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-gray-400 w-16 shrink-0">Событие:</span>
          {EVENT_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setEvent(f.key)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                event === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {retryError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={14} className="shrink-0" />
          {retryError}
        </div>
      )}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
            <Loader2 size={18} className="animate-spin" /> Загрузка…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            Записей не найдено
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 -my-5">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-5 py-3 font-semibold text-gray-600 whitespace-nowrap">Создано</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">Получатель</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">Событие</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">Статус</th>
                  <th className="px-5 py-3 font-semibold text-gray-600 text-center">Попытки</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">Ошибка / Доставлено</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                      {format(new Date(row.created_at), 'd MMM HH:mm', { locale: ru })}
                    </td>
                    <td className="px-5 py-3">
                      {row.profiles ? (
                        <div>
                          <div className="font-medium text-gray-900 truncate max-w-[150px]">
                            {row.profiles.full_name}
                          </div>
                          <div className="text-xs text-gray-400 truncate max-w-[150px]">
                            {row.profiles.email}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-medium text-gray-800">
                        {EVENT_LABELS[row.event_type] ?? row.event_type}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {STATUS_LABELS[row.status] ? (
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          STATUS_LABELS[row.status].cls
                        )}>
                          {STATUS_LABELS[row.status].label}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{row.status}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn(
                        'font-medium tabular-nums',
                        row.attempts >= 3 ? 'text-red-600' : 'text-gray-700'
                      )}>
                        {row.attempts}
                      </span>
                      {row.retry_count > 0 && (
                        <span
                          className="ml-1 text-xs text-indigo-500"
                          title={`Ручных повторов: ${row.retry_count}`}
                        >
                          +{row.retry_count}↺
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 max-w-[200px]">
                      {row.status === 'sent' && row.sent_at ? (
                        <span className="text-xs text-green-600">
                          {format(new Date(row.sent_at), 'd MMM HH:mm', { locale: ru })}
                        </span>
                      ) : row.last_error ? (
                        <span
                          className="text-xs text-red-600 line-clamp-2 cursor-help"
                          title={row.last_error}
                        >
                          {row.last_error}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {row.status === 'failed' && (
                        <button
                          onClick={() => handleRetry(row.id)}
                          disabled={retrying === row.id}
                          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-50 whitespace-nowrap"
                          title="Повторить отправку"
                        >
                          {retrying === row.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <RotateCcw size={12} />
                          }
                          Повторить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalCount > 100 && (
        <p className="text-xs text-gray-400 text-center">
          Показано 100 из {totalCount}. Уточните фильтры.
        </p>
      )}
    </div>
  )
}
