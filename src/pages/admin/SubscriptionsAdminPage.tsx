/**
 * §282. Админка подписки (`/admin/subscriptions`, админ/владелец).
 *
 * Вкладки: подписчики (статусы, ручное продление/отмена, бесплатная выдача),
 * платежи, тарифы (создать/править; тариф на курс делает курс платным),
 * настройки (флаг «подписка», ссылки на оферту/политику/согласие родителя,
 * дни повторов списания), журнал (уведомления ЮKassa, ручные действия, письма).
 *
 * Права — в базе: admin_* функции отбивают не-админа ошибкой ONLY_ADMIN,
 * таблицы закрыты RLS. Страница не открыта без флага: владельцу нужно
 * завести тариф и тексты ДО включения.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/utils/cn'
import {
  adminCancel,
  adminExtend,
  adminGrant,
  fetchAdminPayments,
  fetchAdminSubscriptions,
  fetchFeatureFlag,
  fetchStreamCourses,
  fetchSubscriptionLog,
  fetchSubscriptionSettings,
  fetchTariffs,
  findStudentByEmail,
  saveSubscriptionSettings,
  saveTariff,
  setFeatureFlag,
  type AdminSubscriptionRow,
  type TariffDraft,
  type TariffRow,
} from '@/lib/subscription/api'
import { SUBSCRIPTION_FLAG, resetFeatureFlagCache } from '@/hooks/useSubscription'
import {
  PAYMENT_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  formatRub,
  formatShortDateMsk,
  type SubscriptionStatus,
} from '@/lib/subscription/view'
import { cancelReasonText } from '../../../supabase/functions/_shared/subscription.ts'

type Tab = 'subs' | 'payments' | 'tariffs' | 'settings' | 'log'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'subs', label: 'Подписчики' },
  { key: 'payments', label: 'Платежи' },
  { key: 'tariffs', label: 'Тарифы' },
  { key: 'settings', label: 'Настройки' },
  { key: 'log', label: 'Журнал' },
]

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Ошибка'
}

// ── Подписчики ─────────────────────────────────────────────────────────────

function SubscriberRow({ r, onDone }: { r: AdminSubscriptionRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function act(kind: 'extend' | 'cancel') {
    setErr(null)
    if (kind === 'extend') {
      const days = Number(window.prompt('На сколько дней продлить?', '30'))
      if (!Number.isInteger(days) || days < 1 || days > 366) return
      const reason = window.prompt('Причина (для журнала)', 'ручное продление') ?? ''
      setBusy(true)
      try { await adminExtend(r.id, days, reason) } catch (e) { setErr(errText(e)) }
    } else {
      const reason = window.prompt('Отменить подписку и закрыть курс сейчас? Причина:', '')
      if (reason == null) return
      setBusy(true)
      try { await adminCancel(r.id, reason) } catch (e) { setErr(errText(e)) }
    }
    setBusy(false)
    onDone()
  }

  return (
    <tr className="border-b border-graphite-200 align-top" data-testid="admin-sub-row">
      <td className="py-2 pr-3">
        <div className="font-medium text-graphite-900">{r.full_name || '—'}</div>
        <div className="text-[13px] text-graphite-500">{r.email}</div>
        {!r.enrolled && <div className="text-[13px] text-verdict-bad-ink">не зачислен в группу — см. журнал</div>}
      </td>
      <td className="py-2 pr-3">
        <div>{r.course_title}</div>
        <div className="text-[13px] text-graphite-500">{r.tariff_title}{r.source !== 'purchase' ? ` · ${r.source === 'trial' ? 'пробный' : 'выдана вручную'}` : ''}</div>
      </td>
      <td className="py-2 pr-3">
        <Badge variant={STATUS_TONE[r.status] === 'default' ? 'default' : STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        <div className="mt-1 text-[13px] text-graphite-500">{r.has_access ? `открыт до ${formatShortDateMsk(r.access_until)}` : 'закрыт'}</div>
      </td>
      <td className="py-2 pr-3 text-[13px] text-graphite-700">
        {r.auto_renew ? `автопродление ${formatShortDateMsk(r.next_charge_at) ?? ''}` : 'без автопродления'}
        {r.charge_attempts > 0 && <div className="text-verdict-part-ink">попыток: {r.charge_attempts}{r.last_charge_error ? ` · ${cancelReasonText(r.last_charge_error)}` : ''}</div>}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatRub(r.paid_total_rub)}</td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => act('extend')}>Продлить</Button>
          {r.has_access && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('cancel')}>Отменить</Button>}
        </div>
        {err && <div className="mt-1 text-[13px] text-verdict-bad-ink">✕ {err}</div>}
      </td>
    </tr>
  )
}

function GrantForm({ tariffs, onDone }: { tariffs: TariffRow[]; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [tariffId, setTariffId] = useState('')
  const [days, setDays] = useState('30')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setMsg(null)
    const n = Number(days)
    if (!email.trim() || !tariffId || !Number.isInteger(n) || n < 1 || n > 366) {
      setMsg('Укажите email ученика, тариф и дни (1–366).')
      return
    }
    setBusy(true)
    try {
      const st = await findStudentByEmail(email)
      if (!st) {
        setMsg('Ученик с таким email не найден (или ещё не вступал ни в один курс).')
      } else {
        await adminGrant(st.student_id, tariffId, n, 'выдано вручную')
        setMsg(`Выдано: ${st.full_name ?? email}, ${n} дн.`)
        setEmail('')
        onDone()
      }
    } catch (e) {
      setMsg(errText(e))
    }
    setBusy(false)
  }

  return (
    <div className="mt-6 rounded-lg bg-graphite-50 p-4">
      <h3 className="text-[15px] font-semibold text-graphite-900">Выдать подписку бесплатно</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
        <Input label="Email ученика" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select label="Тариф" value={tariffId} onChange={(e) => setTariffId(e.target.value)}
          options={[{ value: '', label: '— выберите —' }, ...tariffs.map((t) => ({ value: t.id, label: `${t.course?.title ?? ''} · ${t.title}` }))]} />
        <Input label="Дней" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
        <Button onClick={submit} loading={busy}>Выдать</Button>
      </div>
      {msg && <p className="mt-2 text-[13px] text-graphite-700">{msg}</p>}
    </div>
  )
}

function SubscribersTab() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<string>('')
  const list = useQuery({ queryKey: ['admin-subs', status], queryFn: () => fetchAdminSubscriptions(status || null) })
  const tariffs = useQuery({ queryKey: ['admin-tariffs'], queryFn: fetchTariffs })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-subs'] })

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: '', label: 'Все' }, ...(Object.keys(STATUS_LABEL) as SubscriptionStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
        {list.data && <p className="pb-2 text-[13px] text-graphite-500">Подписок: {list.data.length}, с доступом: {list.data.filter((r) => r.has_access).length}</p>}
      </div>
      {list.isLoading && <p className="mt-4 text-graphite-500">Загружаем…</p>}
      {list.error && <p className="mt-4 text-verdict-bad-ink">✕ {errText(list.error)}</p>}
      {list.data && list.data.length === 0 && <p className="mt-4 text-graphite-500">Подписчиков пока нет.</p>}
      {list.data && list.data.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[15px]">
            <thead>
              <tr className="border-b border-graphite-200 text-left text-xs font-semibold uppercase tracking-[.03em] text-graphite-500">
                <th className="py-2 pr-3">Ученик</th><th className="py-2 pr-3">Курс</th><th className="py-2 pr-3">Статус</th>
                <th className="py-2 pr-3">Списание</th><th className="py-2 pr-3 text-right">Оплачено</th><th />
              </tr>
            </thead>
            <tbody>{list.data.map((r) => <SubscriberRow key={r.id} r={r} onDone={refresh} />)}</tbody>
          </table>
        </div>
      )}
      <GrantForm tariffs={tariffs.data ?? []} onDone={refresh} />
    </div>
  )
}

// ── Платежи ────────────────────────────────────────────────────────────────

function PaymentsTab() {
  const pays = useQuery({ queryKey: ['admin-payments'], queryFn: () => fetchAdminPayments() })
  const subs = useQuery({ queryKey: ['admin-subs', ''], queryFn: () => fetchAdminSubscriptions(null) })
  const bySub = useMemo(() => new Map((subs.data ?? []).map((s) => [s.id, s])), [subs.data])
  const total = (pays.data ?? []).filter((p) => p.status === 'succeeded').reduce((a, p) => a + Number(p.amount_rub), 0)

  if (pays.isLoading) return <p className="text-graphite-500">Загружаем…</p>
  if (pays.error) return <p className="text-verdict-bad-ink">✕ {errText(pays.error)}</p>
  if ((pays.data ?? []).length === 0) return <p className="text-graphite-500">Платежей пока нет.</p>
  return (
    <div>
      <p className="text-[17px] text-graphite-900">Успешных платежей на {formatRub(total)} <span className="text-[13px] text-graphite-500">(последние {pays.data!.length})</span></p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-[15px]">
          <thead>
            <tr className="border-b border-graphite-200 text-left text-xs font-semibold uppercase tracking-[.03em] text-graphite-500">
              <th className="py-2 pr-3">Дата</th><th className="py-2 pr-3">Ученик</th><th className="py-2 pr-3">Вид</th>
              <th className="py-2 pr-3 text-right">Сумма</th><th className="py-2 pr-3">Статус</th><th className="py-2">ЮKassa</th>
            </tr>
          </thead>
          <tbody>
            {pays.data!.map((p) => {
              const s = bySub.get(p.subscription_id)
              return (
                <tr key={p.id} className="border-b border-graphite-200">
                  <td className="py-2 pr-3">{formatShortDateMsk(p.paid_at ?? p.created_at)}</td>
                  <td className="py-2 pr-3">{s?.full_name ?? s?.email ?? '—'}</td>
                  <td className="py-2 pr-3">{p.kind === 'renewal' ? 'автопродление' : 'оплата'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatRub(Number(p.amount_rub))}</td>
                  <td className="py-2 pr-3">
                    {PAYMENT_LABEL[p.status]}
                    {p.cancellation_reason && <span className="text-[13px] text-graphite-500"> · {cancelReasonText(p.cancellation_reason)}</span>}
                  </td>
                  <td className="py-2 font-mono text-[12px] text-graphite-500">{p.yookassa_payment_id ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Тарифы ─────────────────────────────────────────────────────────────────

const EMPTY: TariffDraft = {
  course_id: '', title: '', description: '', price_rub: 0, period_months: 1, trial_days: 0,
  is_active: false, sort_order: 0, receipt_vat_code: null,
}

function TariffForm({ initial, id, onDone }: { initial: TariffDraft; id: string | null; onDone: () => void }) {
  const courses = useQuery({ queryKey: ['admin-stream-courses'], queryFn: fetchStreamCourses })
  const [d, setD] = useState<TariffDraft>(initial)
  const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => saveTariff(id, { ...d, description: d.description?.trim() || null }),
    onSuccess: onDone,
    onError: (e) => setErr(errText(e)),
  })
  const set = <K extends keyof TariffDraft>(k: K, v: TariffDraft[K]) => setD((x) => ({ ...x, [k]: v }))

  function submit() {
    setErr(null)
    if (!d.course_id || !d.title.trim() || !(d.price_rub > 0)) {
      setErr('Нужны курс, название и цена больше нуля.')
      return
    }
    if (!id && !window.confirm('Тариф делает курс платным для ВСЕХ его учеников: без подписки курс закроется. Продолжить?')) return
    save.mutate()
  }

  return (
    <div className="mt-4 rounded-lg bg-graphite-50 p-4" data-testid="tariff-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Курс-поток" value={d.course_id} onChange={(e) => set('course_id', e.target.value)} disabled={!!id}
          options={[{ value: '', label: '— выберите —' }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.title }))]} />
        <Input label="Название тарифа" value={d.title} onChange={(e) => set('title', e.target.value)} />
        <Input label="Цена, ₽" inputMode="decimal" value={String(d.price_rub || '')} onChange={(e) => set('price_rub', Number(e.target.value.replace(',', '.')) || 0)} />
        <Input label="Период, месяцев" inputMode="numeric" value={String(d.period_months)} onChange={(e) => set('period_months', Number(e.target.value) || 1)} />
        <Input label="Пробный период, дней (0 — нет)" inputMode="numeric" value={String(d.trial_days)} onChange={(e) => set('trial_days', Number(e.target.value) || 0)} />
        <Input label="Код НДС для чека (пусто — чек не передаём)" inputMode="numeric" value={d.receipt_vat_code == null ? '' : String(d.receipt_vat_code)}
          onChange={(e) => set('receipt_vat_code', e.target.value.trim() ? Number(e.target.value) : null)} />
        <Input label="Порядок на витрине" inputMode="numeric" value={String(d.sort_order)} onChange={(e) => set('sort_order', Number(e.target.value) || 0)} />
        <label className="flex items-center gap-2 self-end pb-3 text-[15px]">
          <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={d.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Показывать на витрине
        </label>
      </div>
      <label className="mt-3 block text-[13px] font-medium text-graphite-700">Описание</label>
      <textarea className="mt-1 w-full rounded-lg border-[1.5px] border-graphite-300 p-2 text-[15px]" rows={3}
        value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      {err && <p className="mt-2 text-[13px] text-verdict-bad-ink">✕ {err}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} loading={save.isPending}>Сохранить</Button>
        <Button variant="ghost" onClick={onDone}>Отмена</Button>
      </div>
    </div>
  )
}

function TariffsTab() {
  const qc = useQueryClient()
  const tariffs = useQuery({ queryKey: ['admin-tariffs'], queryFn: fetchTariffs })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const done = () => {
    setEditing(null)
    void qc.invalidateQueries({ queryKey: ['admin-tariffs'] })
    void qc.invalidateQueries({ queryKey: ['subscription'] })
  }

  return (
    <div>
      <p className="text-[15px] text-graphite-700">
        Тариф привязан к курсу-потоку (копии каркаса). Пока на курс есть хоть один тариф — даже скрытый, — курс открыт только по подписке.
        Скрыть тариф с витрины — снять «Показывать на витрине»; удалять не нужно.
      </p>
      {tariffs.isLoading && <p className="mt-4 text-graphite-500">Загружаем…</p>}
      {tariffs.error && <p className="mt-4 text-verdict-bad-ink">✕ {errText(tariffs.error)}</p>}
      <ul className="mt-4 divide-y divide-graphite-200">
        {(tariffs.data ?? []).map((t) => (
          <li key={t.id} className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-graphite-900">{t.title} · {formatRub(Number(t.price_rub))} / {t.period_months} мес.</div>
                <div className="text-[13px] text-graphite-500">
                  {t.course?.title} · пробный {t.trial_days ? `${t.trial_days} дн.` : 'нет'} · НДС {t.receipt_vat_code ?? '—'}
                </div>
              </div>
              <Badge variant={t.is_active ? 'success' : 'default'}>{t.is_active ? 'на витрине' : 'скрыт'}</Badge>
              <Button size="sm" variant="secondary" onClick={() => setEditing(t.id)}>Изменить</Button>
            </div>
            {editing === t.id && (
              <TariffForm id={t.id} onDone={done} initial={{
                course_id: t.course_id, title: t.title, description: t.description, price_rub: Number(t.price_rub),
                period_months: t.period_months, trial_days: t.trial_days, is_active: t.is_active,
                sort_order: t.sort_order, receipt_vat_code: t.receipt_vat_code,
              }} />
            )}
          </li>
        ))}
      </ul>
      {editing === 'new'
        ? <TariffForm id={null} initial={EMPTY} onDone={done} />
        : <Button className="mt-4" onClick={() => setEditing('new')} data-testid="tariff-new">Новый тариф</Button>}
    </div>
  )
}

// ── Настройки ──────────────────────────────────────────────────────────────

function SettingsTab() {
  const qc = useQueryClient()
  const flag = useQuery({ queryKey: ['admin-flag'], queryFn: () => fetchFeatureFlag(SUBSCRIPTION_FLAG) })
  const settings = useQuery({ queryKey: ['subscription', 'settings'], queryFn: fetchSubscriptionSettings })
  const [draft, setDraft] = useState<{ offer: string; privacy: string; parent: string; retry: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const s = settings.data
  const d = draft ?? {
    offer: s?.offer_url ?? '', privacy: s?.privacy_url ?? '', parent: s?.parent_consent_url ?? '',
    retry: (s?.retry_days ?? [1, 3]).join(', '),
  }

  const toggle = useMutation({
    mutationFn: (on: boolean) => setFeatureFlag(SUBSCRIPTION_FLAG, on),
    onSuccess: () => {
      resetFeatureFlagCache()
      void qc.invalidateQueries({ queryKey: ['admin-flag'] })
      void qc.invalidateQueries({ queryKey: ['subscription'] })
    },
    onError: (e) => setMsg(errText(e)),
  })
  const save = useMutation({
    mutationFn: () => {
      const retry = d.retry.split(/[,\s]+/).filter(Boolean).map(Number)
      if (retry.some((n) => !Number.isInteger(n) || n < 1) || retry.length > 5) throw new Error('Повторы: до 5 целых чисел больше нуля через запятую')
      return saveSubscriptionSettings({
        offer_url: d.offer.trim() || null, privacy_url: d.privacy.trim() || null,
        parent_consent_url: d.parent.trim() || null, retry_days: retry,
      })
    },
    onSuccess: () => {
      setMsg('Сохранено')
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['subscription', 'settings'] })
    },
    onError: (e) => setMsg(errText(e)),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1">
          <p className="text-[17px] font-semibold text-graphite-900">Подписка на сайте: {flag.data ? 'включена' : 'выключена'}</p>
          <p className="text-[13px] text-graphite-500">Выключена — витрина пуста, оформить нельзя, пункта «Моя подписка» нет. Уже оплаченные подписки продолжают работать.</p>
        </div>
        <Button variant={flag.data ? 'secondary' : 'primary'} loading={toggle.isPending} data-testid="flag-toggle"
          onClick={() => {
            const on = !flag.data
            if (on && !window.confirm('Включить подписку для всех? Проверьте тарифы и ссылки на документы.')) return
            toggle.mutate(on)
          }}>
          {flag.data ? 'Выключить' : 'Включить'}
        </Button>
      </div>

      <div className="grid gap-3">
        <Input label="Ссылка на оферту" value={d.offer} onChange={(e) => setDraft({ ...d, offer: e.target.value })} />
        <Input label="Ссылка на политику обработки персональных данных" value={d.privacy} onChange={(e) => setDraft({ ...d, privacy: e.target.value })} />
        <Input label="Ссылка на согласие родителя (для учеников до 18)" value={d.parent} onChange={(e) => setDraft({ ...d, parent: e.target.value })} />
        <Input label="Повторы списания после конца периода, дней (через запятую)" value={d.retry} onChange={(e) => setDraft({ ...d, retry: e.target.value })} />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!draft}>Сохранить</Button>
        {msg && <span className="text-[13px] text-graphite-700">{msg}</span>}
      </div>
    </div>
  )
}

// ── Журнал ─────────────────────────────────────────────────────────────────

function LogTab() {
  const log = useQuery({ queryKey: ['admin-sub-log'], queryFn: () => fetchSubscriptionLog() })
  if (log.isLoading) return <p className="text-graphite-500">Загружаем…</p>
  if (log.error) return <p className="text-verdict-bad-ink">✕ {errText(log.error)}</p>
  if ((log.data ?? []).length === 0) return <p className="text-graphite-500">Событий пока нет.</p>
  return (
    <ul className="divide-y divide-graphite-200 text-[13px]">
      {log.data!.map((l) => (
        <li key={l.id} className="py-2">
          <span className="text-graphite-500">{new Date(l.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>
          {' · '}<span className="font-medium text-graphite-900">{l.event}</span>
          {l.yookassa_object_id && <span className="font-mono text-graphite-500"> · {l.yookassa_object_id}</span>}
          {Object.keys(l.details ?? {}).length > 0 && <span className="text-graphite-500"> · {JSON.stringify(l.details)}</span>}
        </li>
      ))}
    </ul>
  )
}

export function SubscriptionsAdminPage() {
  const [tab, setTab] = useState<Tab>('subs')
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="text-[28px] font-semibold text-graphite-900">Подписка</h1>
      <nav className="mt-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn('rounded-full px-4 py-2 text-[15px]', tab === t.key ? 'bg-gold-300 font-semibold text-graphite-900' : 'bg-white text-graphite-700 hover:bg-graphite-100')}>
            {t.label}
          </button>
        ))}
      </nav>
      <section className="platform-surface mt-4 rounded-card p-4 sm:p-6">
        {tab === 'subs' && <SubscribersTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'tariffs' && <TariffsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'log' && <LogTab />}
      </section>
    </div>
  )
}
