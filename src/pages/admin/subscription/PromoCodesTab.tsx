/**
 * §287. Админка подписки → «Промокоды»: создать код вручную или пачку
 * случайных, выключить, посмотреть погашения (кто, когда, сколько сэкономил).
 *
 * Права и правила — в базе (admin_promo_* отбивают не-админа ONLY_ADMIN,
 * проверки вида кода — CHECK-ограничения таблицы). Форма лишь собирает поля.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import {
  createPromo,
  fetchPromoCodes,
  fetchPromoRedemptions,
  fetchStreamCourses,
  fetchTariffs,
  setPromoActive,
  type PromoKind,
} from '@/lib/subscription/api'
import { formatRub, formatShortDateMsk } from '@/lib/subscription/view'
import { EMPTY_PROMO_FORM as EMPTY, promoCodeLabel, promoDraftOf, type PromoForm as Form } from '@/lib/subscription/promo'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Ошибка'
}

function CreateForm({ onCreated }: { onCreated: (codes: string[]) => void }) {
  const [f, setF] = useState<Form>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  const courses = useQuery({ queryKey: ['admin-stream-courses'], queryFn: fetchStreamCourses })
  const tariffs = useQuery({ queryKey: ['admin-tariffs'], queryFn: fetchTariffs })
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const create = useMutation({
    mutationFn: () => createPromo(promoDraftOf(f)),
    onSuccess: (r) => {
      setErr(null)
      setF(EMPTY)
      onCreated(r.codes)
    },
    onError: (e) => setErr(errText(e)),
  })

  return (
    <div className="space-y-3 rounded-card border border-graphite-200 p-4" data-testid="promo-form">
      <p className="text-[17px] font-semibold text-graphite-900">Новый промокод</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Вид" value={f.kind} onChange={(e) => set('kind', e.target.value as PromoKind)} data-testid="promo-kind"
          options={[
            { value: 'percent', label: 'Скидка, %' },
            { value: 'free_days', label: 'Бесплатные дни' },
            { value: 'free_months', label: 'Бесплатные месяцы' },
          ]} />
        <Input label={f.kind === 'percent' ? 'Скидка, %' : f.kind === 'free_days' ? 'Дней' : 'Месяцев'}
          inputMode="numeric" value={f.value} onChange={(e) => set('value', e.target.value)} data-testid="promo-value" />
        {f.kind === 'percent' && (
          <Input label="Платежей со скидкой (1 — только первый)" inputMode="numeric" value={f.payments}
            onChange={(e) => set('payments', e.target.value)} data-testid="promo-payments" />
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Курс" value={f.courseId} onChange={(e) => set('courseId', e.target.value)}
          options={[{ value: '', label: 'Любой' }, ...(courses.data ?? []).map((c) => ({ value: c.id, label: c.title }))]} />
        <Select label="Тариф" value={f.tariffId} onChange={(e) => set('tariffId', e.target.value)}
          options={[{ value: '', label: 'Любой' }, ...(tariffs.data ?? []).map((t) => ({ value: t.id, label: `${t.course?.title ?? ''} · ${t.title}` }))]} />
        <Input label="Лимит использований (пусто — без лимита)" inputMode="numeric" value={f.maxUses}
          onChange={(e) => set('maxUses', e.target.value)} data-testid="promo-max" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Действует с (МСК)" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <Input label="Действует по (включительно)" type="date" value={f.until} onChange={(e) => set('until', e.target.value)} />
        <Input label="Заметка (кому, зачем)" value={f.note} onChange={(e) => set('note', e.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Как создать" value={f.how} onChange={(e) => set('how', e.target.value as Form['how'])} data-testid="promo-how"
          options={[{ value: 'manual', label: 'Свой код' }, { value: 'batch', label: 'Пачка случайных' }]} />
        {f.how === 'manual' ? (
          <Input label="Код (латиница, цифры, «-»)" value={f.code} onChange={(e) => set('code', e.target.value)} data-testid="promo-code" />
        ) : (
          <>
            <Input label="Сколько" inputMode="numeric" value={f.count} onChange={(e) => set('count', e.target.value)} data-testid="promo-count" />
            <Input label="Префикс (необязательно)" value={f.prefix} onChange={(e) => set('prefix', e.target.value)} />
          </>
        )}
        <Button onClick={() => create.mutate()} loading={create.isPending} data-testid="promo-create">Создать</Button>
      </div>
      <p className="text-[13px] text-graphite-500">Каждый ученик может использовать код один раз. Регистр букв не важен.</p>
      {err && <p className="text-[13px] text-verdict-bad-ink" data-testid="promo-form-error">✕ {err}</p>}
    </div>
  )
}

function Redemptions({ codeId, onClose }: { codeId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-promo-red', codeId], queryFn: () => fetchPromoRedemptions(codeId) })
  return (
    <div className="mt-4 rounded-card border border-graphite-200 p-4" data-testid="promo-redemptions">
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-semibold text-graphite-900">Погашения{codeId ? ' кода' : ''}</p>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
      {q.isLoading && <p className="text-graphite-500">Загружаем…</p>}
      {q.error && <p className="text-verdict-bad-ink">✕ {errText(q.error)}</p>}
      {q.data && q.data.length === 0 && <p className="text-graphite-500">Погашений пока нет.</p>}
      {q.data && q.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-[13px]">
            <thead className="text-left text-graphite-500">
              <tr><th className="py-1 pr-3">Когда</th><th className="pr-3">Ученик</th><th className="pr-3">Код</th><th className="pr-3">Курс</th><th className="pr-3">Статус</th><th className="pr-3 text-right">Сэкономил</th></tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="border-t border-graphite-200">
                  <td className="py-1 pr-3">{formatShortDateMsk(r.applied_at ?? r.created_at)}</td>
                  <td className="pr-3">{r.full_name ?? '—'} <span className="text-graphite-500">{r.email}</span></td>
                  <td className="pr-3 font-mono">{r.code}</td>
                  <td className="pr-3">{r.course_title ?? '—'}</td>
                  <td className="pr-3">
                    {r.status === 'applied' ? 'применён' : 'ждёт оплаты'}
                    {r.payments_left > 0 && <span className="text-graphite-500"> · ещё {r.payments_left} со скидкой</span>}
                  </td>
                  <td className="pr-3 text-right">{formatRub(Number(r.saved_rub))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function PromoCodesTab() {
  const qc = useQueryClient()
  const codes = useQuery({ queryKey: ['admin-promo-codes'], queryFn: fetchPromoCodes })
  const [created, setCreated] = useState<string[] | null>(null)
  const [show, setShow] = useState<{ codeId: string | null } | null>(null)
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setPromoActive(id, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-promo-codes'] }),
  })

  return (
    <div className="space-y-4">
      <CreateForm onCreated={(c) => { setCreated(c); void qc.invalidateQueries({ queryKey: ['admin-promo-codes'] }) }} />
      {created && (
        <div className="rounded-card bg-verdict-ok-tint p-4" data-testid="promo-created">
          <p className="text-[15px] text-verdict-ok-ink">Создано: {created.length}. Скопируйте и раздайте:</p>
          <textarea readOnly className="mt-2 h-32 w-full rounded-lg border border-graphite-200 p-2 font-mono text-[13px]"
            value={created.join('\n')} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[17px] font-semibold text-graphite-900">Коды</p>
        <Button variant="secondary" onClick={() => setShow({ codeId: null })} data-testid="promo-all-redemptions">Все погашения</Button>
      </div>
      {codes.isLoading && <p className="text-graphite-500">Загружаем…</p>}
      {codes.error && <p className="text-verdict-bad-ink">✕ {errText(codes.error)}</p>}
      {codes.data && codes.data.length === 0 && <p className="text-graphite-500">Промокодов пока нет.</p>}
      {codes.data && codes.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="promo-list">
            <thead className="text-left text-graphite-500">
              <tr><th className="py-1 pr-3">Код</th><th className="pr-3">Что даёт</th><th className="pr-3">Где</th><th className="pr-3">Использован</th><th className="pr-3">Срок</th><th className="pr-3 text-right">Сэкономили</th><th /></tr>
            </thead>
            <tbody>
              {codes.data.map((c) => (
                <tr key={c.id} className="border-t border-graphite-200" data-testid="promo-row">
                  <td className="py-1 pr-3 font-mono">
                    {c.code} {!c.is_active && <Badge variant="default">выключен</Badge>}
                    {c.note && <span className="block font-sans text-graphite-500">{c.note}</span>}
                  </td>
                  <td className="pr-3">{promoCodeLabel(c)}</td>
                  <td className="pr-3">{c.tariff_title ?? c.course_title ?? 'везде'}</td>
                  <td className="pr-3">{c.used_count}{c.max_uses != null ? ` из ${c.max_uses}` : ''}</td>
                  <td className="pr-3">
                    {c.valid_from || c.valid_until
                      ? `${formatShortDateMsk(c.valid_from) ?? '…'} — ${c.valid_until ? formatShortDateMsk(new Date(new Date(c.valid_until).getTime() - 1).toISOString()) : '…'}`
                      : 'бессрочно'}
                  </td>
                  <td className="pr-3 text-right">{formatRub(Number(c.saved_total_rub))}</td>
                  <td className="whitespace-nowrap py-1 text-right">
                    <Button variant="ghost" onClick={() => setShow({ codeId: c.id })}>Погашения</Button>
                    <Button variant="ghost" loading={toggle.isPending && toggle.variables?.id === c.id}
                      onClick={() => toggle.mutate({ id: c.id, on: !c.is_active })} data-testid="promo-toggle">
                      {c.is_active ? 'Выключить' : 'Включить'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toggle.error && <p className="text-[13px] text-verdict-bad-ink">✕ {errText(toggle.error)}</p>}
      {show && <Redemptions codeId={show.codeId} onClose={() => setShow(null)} />}
    </div>
  )
}
