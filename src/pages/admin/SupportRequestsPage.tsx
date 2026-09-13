import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { ROLE_LABELS, formatDateTime } from '@/utils/format'

/**
 * Обращения «Сообщить о проблеме» (§57) — экран администратора.
 *
 * До §169 обращения писались в `support_requests`, колокольчик звенел один
 * раз — и всё: экрана со списком не было, статус `new` снять было негде.
 * Поэтому семь обращений с 3 августа лежали «новыми», а четыре из них
 * оказались настоящими дефектами. Строка «Разобрать обращения» на «Обзоре»
 * ведёт сюда; без этого экрана она бы никогда не погасла.
 *
 * Данные читаются таблицей напрямую: `select` для админа и `update` для
 * админа разрешены политиками §57, второй RPC ради этого не нужен. Права
 * решает RLS, а не экран: у не-админа список будет пуст, и это честно
 * скажет заглушка (маршрут закрыт RoleGuard, так что до этого не дойдёт).
 *
 * Скриншоты лежат в приватном бакете `support-attachments`; ссылки
 * подписываются на момент показа (в строке хранятся только пути — §57).
 */
type Status = 'new' | 'in_progress' | 'closed'
type Filter = Status | 'all'

export interface SupportRequestRow {
  id:          string
  author_id:   string
  author_name: string | null
  author_role: string | null
  subject:     string | null
  message:     string
  page_path:   string | null
  attachments: string[]
  status:      string
  created_at:  string
  resolved_at: string | null
}

const BUCKET = 'support-attachments'

const STATUS_LABELS: Record<Status, { label: string; cls: string }> = {
  new:         { label: 'Новое',    cls: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'В работе', cls: 'bg-blue-100 text-blue-800' },
  closed:      { label: 'Закрыто',  cls: 'bg-gray-100 text-gray-600' },
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'new',         label: 'Новые' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'closed',      label: 'Закрытые' },
  { key: 'all',         label: 'Все' },
]

function Attachment({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.storage.from(BUCKET).createSignedUrl(path, 600).then(({ data }) => {
      if (!cancelled) setUrl(data?.signedUrl ?? null)
    })
    return () => { cancelled = true }
  }, [path])
  if (!url) return <span className="text-xs text-gray-400">скриншот…</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt="Скриншот к обращению" className="h-24 rounded-lg border border-gray-200 object-cover" />
    </a>
  )
}

export function SupportRequestsPage() {
  const [rows,    setRows]    = useState<SupportRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [saving,  setSaving]  = useState<string | null>(null)
  const [filter,  setFilter]  = useState<Filter>('new')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('support_requests')
      .select('id, author_id, author_name, author_role, subject, message, page_path, attachments, status, created_at, resolved_at')
    if (filter !== 'all') q = q.eq('status', filter)
    const { data, error: e } = await q.order('created_at', { ascending: false }).limit(200)
    if (e) {
      setError(e.message)
      setRows([])
    } else {
      setRows((data ?? []) as unknown as SupportRequestRow[])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function setStatus(id: string, status: Status) {
    setSaving(id)
    setError(null)
    // Кто и когда закрыл — в строке, а не в логах: обращение потом читают
    // спустя недели, и «кто это разбирал» — первый вопрос.
    const { data: auth } = await supabase.auth.getUser()
    const patch = status === 'closed'
      ? { status, resolved_at: new Date().toISOString(), resolved_by: auth?.user?.id ?? null }
      : { status, resolved_at: null, resolved_by: null }
    const { error: e } = await supabase.from('support_requests').update(patch).eq('id', id)
    if (e) {
      setError(e.message)
    } else {
      // Строка, вышедшая из текущего фильтра, уходит из списка сразу, а не
      // после «Обновить»: иначе «В работу» выглядит как «ничего не произошло».
      setRows(prev => prev
        .map(r => (r.id === id ? { ...r, status, resolved_at: patch.resolved_at } : r))
        .filter(r => filter === 'all' || r.status === filter))
    }
    setSaving(null)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <LifeBuoy size={20} />Обращения
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Написали через «Сообщить о проблеме»
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} loading={loading}>
          <RefreshCw size={14} className="mr-1.5" />Обновить
        </Button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn(
              'min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-all',
              filter === f.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}>
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-center py-10 text-gray-400 text-sm">
          {filter === 'new' ? 'Новых обращений нет' : 'Обращений нет'}
        </p>
      )}

      <div className="space-y-3" data-testid="support-requests">
        {rows.map(r => {
          const st = STATUS_LABELS[r.status as Status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-600' }
          return (
            <article key={r.id} className="platform-surface rounded-lg p-4 space-y-3" aria-label={r.subject ?? 'Обращение'}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', st.cls)}>{st.label}</span>
                <span className="font-semibold text-gray-900">{r.author_name ?? 'Без имени'}</span>
                {r.author_role && <span className="text-gray-500">{ROLE_LABELS[r.author_role] ?? r.author_role}</span>}
                <span className="text-gray-400">· {formatDateTime(r.created_at)}</span>
                {r.page_path && <span className="text-gray-400 truncate">· {r.page_path}</span>}
              </div>
              {r.subject && <p className="font-medium text-gray-900">{r.subject}</p>}
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.message}</p>
              {r.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {r.attachments.map(p => <Attachment key={p} path={p} />)}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {r.status === 'new' && (
                  <Button size="sm" variant="secondary" loading={saving === r.id} onClick={() => setStatus(r.id, 'in_progress')}>
                    В работу
                  </Button>
                )}
                {r.status !== 'closed' && (
                  <Button size="sm" variant="primary" loading={saving === r.id} onClick={() => setStatus(r.id, 'closed')}>
                    Закрыть
                  </Button>
                )}
                {r.status === 'closed' && (
                  <Button size="sm" variant="ghost" loading={saving === r.id} onClick={() => setStatus(r.id, 'new')}>
                    Открыть заново
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
