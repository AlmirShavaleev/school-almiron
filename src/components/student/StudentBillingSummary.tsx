import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchAdminSubscriptions, type AdminSubscriptionRow } from '@/lib/subscription/api'
import { STATUS_LABEL, formatDateMsk, formatRub } from '@/lib/subscription/view'

export interface StudentPayment {
  id: string; subscription_id: string; amount_rub: number; status: string
  is_test: boolean | null; paid_at: string | null; created_at: string; refunded_at: string | null
}

export async function loadStudentBilling(studentId: string) {
  const [subscriptions, result] = await Promise.all([
    fetchAdminSubscriptions(null),
    supabase.from('subscription_payments' as never)
      .select('id, subscription_id, amount_rub, status, is_test, paid_at, created_at, refunded_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false }).limit(20),
  ])
  if (result.error) throw result.error
  return {
    subscriptions: subscriptions.filter(s => s.student_id === studentId),
    payments: (result.data ?? []) as unknown as StudentPayment[],
  }
}

const paymentStatus: Record<string, string> = {
  created: 'Создан', pending: 'Ожидает оплаты', waiting_for_capture: 'Ожидает подтверждения',
  succeeded: 'Оплачен', canceled: 'Отменён', cancelled: 'Отменён', refunded: 'Возврат',
}

export function StudentBillingSummary({ studentId, email }: { studentId: string; email: string }) {
  const [state, setState] = useState<{ studentId: string; subscriptions: AdminSubscriptionRow[]; payments: StudentPayment[] } | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState(null); setError(false)
    loadStudentBilling(studentId).then(data => {
      if (!cancelled) setState({ studentId, ...data })
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [studentId, tick])
  const data = state?.studentId === studentId ? state : null
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-5" aria-label="Подписки и платежи ученика">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Подписки и платежи</h2>
        <div className="flex gap-4 text-sm text-primary-600">
          <button onClick={() => setTick(t => t + 1)}>Обновить</button>
          <Link to={'/admin/finance?tab=subs&search=' + encodeURIComponent(email)}>Управлять подписками →</Link>
        </div>
      </div>
      {error ? <div role="alert" className="text-sm text-red-700">Не удалось загрузить подписки и платежи. <button className="underline" onClick={() => setTick(t => t + 1)}>Повторить</button></div> : !data ? <p role="status">Загрузка подписок и платежей…</p> : <>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.subscriptions.map(s => {
            const open = s.has_access && (!s.access_until || new Date(s.access_until).getTime() > Date.now())
            return <article key={s.id} className="rounded-xl bg-slate-50 p-4 space-y-1">
              <h3 className="font-semibold">{s.course_title}</h3>
              <p className={open ? 'text-green-700 text-sm' : 'text-amber-700 text-sm'}>{open ? 'Доступ открыт' : 'Доступ закрыт'} · {STATUS_LABEL[s.status] ?? s.status}</p>
              <p className="text-sm">Срок доступа: {formatDateMsk(s.access_until) ?? 'не указан'}</p>
              <p className="text-xs text-gray-500">{s.source === 'manual' ? 'Выдан вручную' : s.source === 'trial' ? 'Пробный доступ' : 'Оформленная подписка'} · Автопродление {s.auto_renew ? 'включено' : 'выключено'}</p>
              {s.last_charge_error && <p className="text-sm text-red-700">Последнее продление не удалось. Проверьте подписку.</p>}
            </article>
          })}
        </div>
        {!data.subscriptions.length && <p className="text-sm text-gray-500">Подписок пока нет. Зачисление на курс показано отдельно ниже.</p>}
        <div>
          <h3 className="font-semibold">Последние платежи</h3>
          <p className="text-xs text-gray-500 mt-1">До 20 последних попыток оплаты. Тестовые платежи не являются реальным доходом. Даты — Москва.</p>
          {!data.payments.length ? <p className="py-4 text-sm text-gray-500">Платежей пока нет.</p> : <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm text-left">
              <thead><tr className="text-gray-500 border-b"><th className="p-2">Дата</th><th className="p-2">Курс</th><th className="p-2">Сумма</th><th className="p-2">Статус</th><th className="p-2">Режим</th></tr></thead>
              <tbody>{data.payments.map(p => <tr key={p.id} className="border-b last:border-0">
                <td className="p-2 whitespace-nowrap">{formatDateMsk(p.paid_at ?? p.created_at)}</td>
                <td className="p-2">{data.subscriptions.find(s => s.id === p.subscription_id)?.course_title ?? 'Курс не определён'}</td>
                <td className="p-2 whitespace-nowrap font-semibold">{formatRub(Number(p.amount_rub))}</td>
                <td className="p-2">{p.refunded_at ? 'Возврат зарегистрирован' : paymentStatus[p.status] ?? p.status}</td>
                <td className="p-2">{p.is_test === true ? 'Тестовый' : p.is_test === false ? 'Реальный' : 'Не проверен'}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>
      </>}
    </section>
  )
}
