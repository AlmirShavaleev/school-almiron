/**
 * §287. Промокоды в админке: подпись «что даёт код» и сборка черновика для
 * admin_promo_create из полей формы. Проверки здесь — только чтобы показать
 * понятную ошибку раньше; окончательные правила — CHECK-ограничения в базе.
 */
import type { PromoCodeRow, PromoDraft, PromoKind } from './api'
import { daysLabel, monthsLabel } from './view'
import { plural } from '@/lib/plural'

/** Что даёт код — коротко, для таблицы. */
export function promoCodeLabel(c: Pick<PromoCodeRow, 'kind' | 'percent' | 'discount_payments' | 'free_days' | 'free_months'>): string {
  if (c.kind === 'free_days') return `${daysLabel(c.free_days ?? 0)} бесплатно`
  if (c.kind === 'free_months') return `${monthsLabel(c.free_months ?? 0)} бесплатно`
  const n = c.discount_payments
  return `−${c.percent} % ${n === 1 ? 'на первый платёж' : `на ${n} ${plural(n, 'платёж', 'платежа', 'платежей')}`}`
}

/** Дата из поля «дата» (МСК) → момент начала этого дня; для «по» — начало следующего. */
function mskDayStart(d: string, nextDay = false): string | null {
  if (!d) return null
  const t = new Date(`${d}T00:00:00+03:00`).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t + (nextDay ? 86_400_000 : 0)).toISOString()
}

export interface PromoForm {
  kind: PromoKind
  value: string
  payments: string
  courseId: string
  tariffId: string
  maxUses: string
  from: string
  until: string
  note: string
  how: 'manual' | 'batch'
  code: string
  count: string
  prefix: string
}

export const EMPTY_PROMO_FORM: PromoForm = {
  kind: 'percent', value: '20', payments: '1', courseId: '', tariffId: '', maxUses: '', from: '', until: '',
  note: '', how: 'manual', code: '', count: '10', prefix: '',
}

/** Поля формы → черновик для admin_promo_create. Ошибки — понятным текстом. */
export function promoDraftOf(f: PromoForm): PromoDraft {
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const value = num(f.value)
  if (value == null || !Number.isInteger(value) || value < 1) throw new Error('Укажите размер: целое число больше нуля')
  if (f.kind === 'percent' && value > 100) throw new Error('Скидка — от 1 до 100 %')
  const payments = num(f.payments) ?? 1
  if (!Number.isInteger(payments) || payments < 1 || payments > 24) throw new Error('Платежей со скидкой — от 1 до 24')
  const maxUses = num(f.maxUses)
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) throw new Error('Лимит использований — целое число больше нуля или пусто')
  const draft: PromoDraft = {
    kind: f.kind,
    percent: f.kind === 'percent' ? value : null,
    discount_payments: f.kind === 'percent' ? payments : 1,
    free_days: f.kind === 'free_days' ? value : null,
    free_months: f.kind === 'free_months' ? value : null,
    course_id: f.courseId || null,
    tariff_id: f.tariffId || null,
    max_uses: maxUses,
    valid_from: mskDayStart(f.from),
    valid_until: mskDayStart(f.until, true),
    note: f.note.trim() || null,
  }
  if (f.how === 'manual') {
    if (!f.code.trim()) throw new Error('Введите код или выберите «пачка случайных»')
    draft.code = f.code.trim()
  } else {
    const count = num(f.count)
    if (count == null || !Number.isInteger(count) || count < 1 || count > 500) throw new Error('Количество — от 1 до 500')
    draft.count = count
    draft.prefix = f.prefix.trim() || null
  }
  return draft
}
