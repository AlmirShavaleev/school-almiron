import { useCallback, useEffect, useState } from 'react'
import { Bell, ChevronDown, ChevronRight, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import type { NotifyTarget } from '@/hooks/useTopicHomework'

/**
 * Аккордеон «Оповестить в Telegram» в модалке ДЗ.
 *
 * Показывает учеников курса, у каждого — привязан ли Telegram, и даёт послать
 * оповещение точечно либо всем привязанным разом.
 *
 * Про привязку известно ровно одно: да или нет. Список приходит из
 * definer-функции `topic_homework_notify_targets`, потому что политики
 * `telegram_connections` не пускают преподавателя к чужим строкам; ни chat_id,
 * ни имени в телеграме сюда не приезжает и приезжать не должно.
 *
 * Карточка в Telegram — прежняя `new_homework`: событие и текст не менялись,
 * иначе понадобилось бы согласование с чатом уведомлений.
 */
export function TopicHomeworkNotify({
  loadTargets,
  onNotify,
  className,
  openSignal,
}: {
  loadTargets: () => Promise<NotifyTarget[]>
  /** Без списка — всем привязанным. Возвращает, сколько встало в очередь. */
  onNotify: (profileIds?: string[]) => Promise<number>
  className?: string
  /**
   * Раскрыть снаружи — после публикации ДЗ (§95). Только раскрывает и никогда
   * не закрывает: иначе перерисовка родителя схлопывала бы аккордеон под
   * руками у преподавателя.
   */
  openSignal?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])
  const [targets, setTargets] = useState<NotifyTarget[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** profile_id, по которому прямо сейчас идёт отправка; 'all' — кнопка «всем». */
  const [sending, setSending] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTargets(await loadTargets())
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось загрузить список учеников')
    } finally {
      setLoading(false)
    }
  }, [loadTargets])

  // Список тянем только когда аккордеон раскрыли: закрытый он не должен стоить
  // ни одного запроса — модалка ДЗ открывается и ради других правок.
  useEffect(() => {
    if (open && targets === null) void refresh()
  }, [open, targets, refresh])

  const linked = (targets ?? []).filter(t => t.telegram_linked)

  async function send(profileIds: string[] | undefined, key: string) {
    setSending(key)
    setNote(null)
    setError(null)
    try {
      const n = await onNotify(profileIds)
      setNote(n === 0
        ? 'Никому не отправлено: оповещение уже в очереди'
        : `Отправлено: ${n}`)
      // Перечитываем: у отправленных появляется отметка «в очереди».
      await refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось отправить оповещение')
    } finally {
      setSending(null)
    }
  }

  return (
    <div className={cn('rounded-xl border border-gray-200', className)}>
      <button
        type="button"
        data-testid="homework-notify-accordion"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <Bell size={14} className="text-gray-400" />
        Оповестить в Telegram
        {targets !== null && (
          <span className="ml-auto text-xs font-normal text-gray-400">
            привязан Telegram: {linked.length} из {targets.length}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Загружаем список…
            </div>
          )}

          {error && (
            <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {!loading && targets !== null && targets.length === 0 && (
            <p className="py-2 text-sm text-gray-400">В курсе пока нет учеников</p>
          )}

          {!loading && targets !== null && targets.length > 0 && (
            <>
              <ul className="divide-y divide-gray-100">
                {targets.map(t => (
                  <li key={t.profile_id} className="flex items-center gap-2 py-1.5">
                    <span
                      className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
                        t.telegram_linked ? 'bg-emerald-500' : 'bg-gray-300')}
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-sm',
                      t.telegram_linked ? 'text-gray-800' : 'text-gray-400')}>
                      {t.full_name}
                    </span>

                    {!t.telegram_linked && (
                      <span className="shrink-0 text-xs text-gray-400">Telegram не привязан</span>
                    )}
                    {t.telegram_linked && t.pending && (
                      <span className="shrink-0 text-xs text-gray-400">в очереди</span>
                    )}
                    {t.telegram_linked && (
                      <button
                        type="button"
                        onClick={() => void send([t.profile_id], t.profile_id)}
                        disabled={sending !== null}
                        title="Отправить оповещение этому ученику"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
                      >
                        {sending === t.profile_id
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Send size={11} />}
                        Отправить
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void send(undefined, 'all')}
                  disabled={sending !== null || linked.length === 0}
                  loading={sending === 'all'}
                >
                  <Bell size={14} />
                  Оповестить всех
                </Button>
                {linked.length === 0 && (
                  <span className="text-xs text-gray-400">Ни у кого не привязан Telegram</span>
                )}
                {note && <span className="text-xs text-gray-500">{note}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
