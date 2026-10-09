/**
 * §282. Вызовы базы и edge-функции подписки. Имена RPC не входят в
 * сгенерированные типы (`src/types/database.ts` отстаёт от прода) — отсюда
 * `as never`, как в остальных хуках на новых RPC.
 */
import { supabase } from '@/lib/supabase'
import type { CheckoutForm, MySubscription, PaymentStatus, PublicTariff } from './view'

export class SubscriptionError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.code = code
  }
}

type RpcError = { message: string; hint?: string | null; code?: string | null } | null

function fail(error: RpcError): never {
  throw new SubscriptionError(error?.message ?? 'Ошибка', error?.hint ?? error?.code ?? null)
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, (args ?? {}) as never)
  if (error) fail(error as RpcError)
  return data as T
}

export async function fetchFeatureFlag(key: string): Promise<boolean> {
  const { data, error } = await supabase.from('app_feature_flags' as never).select('enabled').eq('key', key).maybeSingle()
  if (error) return false
  return (data as { enabled?: boolean } | null)?.enabled === true
}

export function fetchPublicTariffs(): Promise<PublicTariff[]> {
  return rpc<PublicTariff[]>('subscription_tariffs_public').then((d) => d ?? [])
}

export interface SubscriptionSettings {
  offer_url: string | null
  privacy_url: string | null
  parent_consent_url: string | null
  retry_days: number[]
}

export async function fetchSubscriptionSettings(): Promise<SubscriptionSettings | null> {
  const { data, error } = await supabase.from('subscription_settings' as never).select('*').maybeSingle()
  if (error) return null
  return data as SubscriptionSettings | null
}

export function fetchMySubscriptions(): Promise<MySubscription[]> {
  return rpc<MySubscription[]>('my_subscriptions').then((d) => d ?? [])
}

export interface CourseAccess {
  paid: boolean
  has_access: boolean
  status: string | null
  access_until: string | null
  tariff_id: string | null
}

export function fetchCourseAccess(courseId: string): Promise<CourseAccess> {
  return rpc<CourseAccess>('my_course_access', { p_course_id: courseId })
}

export function setAutoRenew(subscriptionId: string, on: boolean): Promise<{ auto_renew: boolean }> {
  return rpc('subscription_set_auto_renew', { p_subscription_id: subscriptionId, p_on: on })
}

export function startTrial(tariffId: string, f: CheckoutForm): Promise<{ subscription_id: string; access_until: string }> {
  return rpc('subscription_start_trial', {
    p_tariff_id: tariffId,
    p_is_minor: f.isMinor,
    p_parent_consent: f.parentConsent,
    p_accepted_offer: f.acceptedOffer,
  })
}

/** Создать платёж; вернуть ссылку на страницу ЮKassa. */
export async function beginCheckout(tariffId: string, f: CheckoutForm): Promise<{ confirmation_url: string; payment_id: string }> {
  const { data, error } = await supabase.functions.invoke('subscription-checkout', {
    body: {
      tariff_id: tariffId,
      save_card: f.saveCard,
      is_minor: f.isMinor,
      parent_consent: f.parentConsent,
      accepted_offer: f.acceptedOffer,
      receipt_email: f.email.trim(),
    },
  })
  if (error) {
    // FunctionsHttpError: тело ответа с { error, code } — в context
    let code: string | null = null
    let message = error.message
    try {
      const body = await (error as { context?: Response }).context?.json()
      code = body?.code ?? null
      message = body?.error ?? message
    } catch {
      /* тело не JSON */
    }
    throw new SubscriptionError(message, code)
  }
  if (!data?.confirmation_url) throw new SubscriptionError('Не получена ссылка на оплату', 'NO_CONFIRMATION')
  return data
}

export interface PaymentRow {
  id: string
  status: PaymentStatus
  amount_rub: number
  paid_at: string | null
  cancellation_reason: string | null
  subscription_id: string
}

/** Своя строка платежа (RLS: ученик видит только свои). */
export async function fetchPayment(paymentId: string): Promise<PaymentRow | null> {
  const { data, error } = await supabase
    .from('subscription_payments' as never)
    .select('id, status, amount_rub, paid_at, cancellation_reason, subscription_id')
    .eq('id', paymentId)
    .maybeSingle()
  if (error) fail(error as RpcError)
  return data as PaymentRow | null
}

// ── админка ───────────────────────────────────────────────────────────────

export interface AdminSubscriptionRow {
  id: string
  student_id: string
  profile_id: string
  full_name: string | null
  email: string | null
  course_id: string
  course_title: string
  tariff_title: string
  status: MySubscription['status']
  source: 'purchase' | 'trial' | 'manual'
  has_access: boolean
  current_period_end: string | null
  access_until: string | null
  auto_renew: boolean
  next_charge_at: string | null
  charge_attempts: number
  last_charge_error: string | null
  enrolled: boolean
  paid_total_rub: number
  created_at: string
}

export function fetchAdminSubscriptions(status: string | null): Promise<AdminSubscriptionRow[]> {
  return rpc<AdminSubscriptionRow[]>('admin_subscriptions', { p_status: status }).then((d) => d ?? [])
}

export function adminExtend(id: string, days: number, reason: string) {
  return rpc('admin_subscription_extend', { p_subscription_id: id, p_days: days, p_reason: reason })
}

export function adminCancel(id: string, reason: string) {
  return rpc('admin_subscription_cancel', { p_subscription_id: id, p_reason: reason })
}

export function adminGrant(studentId: string, tariffId: string, days: number, reason: string) {
  return rpc('admin_subscription_grant', { p_student_id: studentId, p_tariff_id: tariffId, p_days: days, p_reason: reason })
}

export interface AdminPaymentRow {
  id: string
  subscription_id: string
  kind: 'initial' | 'renewal'
  amount_rub: number
  status: PaymentStatus
  cancellation_reason: string | null
  yookassa_payment_id: string | null
  paid_at: string | null
  created_at: string
}

export async function fetchAdminPayments(limit = 200): Promise<AdminPaymentRow[]> {
  const { data, error } = await supabase
    .from('subscription_payments' as never)
    .select('id, subscription_id, kind, amount_rub, status, cancellation_reason, yookassa_payment_id, paid_at, created_at')
    .neq('status', 'created')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) fail(error as RpcError)
  return (data ?? []) as AdminPaymentRow[]
}

export interface TariffRow {
  id: string
  course_id: string
  title: string
  description: string | null
  price_rub: number
  period_months: number
  trial_days: number
  is_active: boolean
  sort_order: number
  receipt_vat_code: number | null
  course?: { title: string } | null
}

export type TariffDraft = Omit<TariffRow, 'id' | 'course'>

export async function fetchTariffs(): Promise<TariffRow[]> {
  const { data, error } = await supabase
    .from('subscription_tariffs' as never)
    .select('*, course:courses(title)')
    .order('sort_order')
  if (error) fail(error as RpcError)
  return (data ?? []) as TariffRow[]
}

export async function saveTariff(id: string | null, draft: TariffDraft): Promise<void> {
  const q = id
    ? supabase.from('subscription_tariffs' as never).update(draft as never).eq('id', id)
    : supabase.from('subscription_tariffs' as never).insert(draft as never)
  const { error } = await q
  if (error) fail(error as RpcError)
}

export interface CourseOption { id: string; title: string }

/** Курсы, на которые можно повесить тариф: не шаблоны (в шаблон не зачисляют). */
export async function fetchStreamCourses(): Promise<CourseOption[]> {
  const { data, error } = await supabase.from('courses').select('id, title').eq('is_template', false).order('title')
  if (error) fail(error as RpcError)
  return (data ?? []) as CourseOption[]
}

export async function setFeatureFlag(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('app_feature_flags' as never).update({ enabled } as never).eq('key', key)
  if (error) fail(error as RpcError)
}

export async function saveSubscriptionSettings(patch: Partial<SubscriptionSettings>): Promise<void> {
  const { error } = await supabase.from('subscription_settings' as never).update(patch as never).eq('id', true)
  if (error) fail(error as RpcError)
}

export interface LogRow {
  id: number
  subscription_id: string | null
  event: string
  yookassa_object_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export async function fetchSubscriptionLog(limit = 100): Promise<LogRow[]> {
  const { data, error } = await supabase
    .from('subscription_log' as never)
    .select('id, subscription_id, event, yookassa_object_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) fail(error as RpcError)
  return (data ?? []) as LogRow[]
}

/** Ученик по email — для бесплатной выдачи. null — не найден или не ученик. */
export async function findStudentByEmail(email: string): Promise<{ student_id: string; full_name: string | null } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, students(id)')
    .ilike('email', email.trim())
    .maybeSingle()
  if (error) fail(error as RpcError)
  const row = data as { full_name: string | null; role: string; students: { id: string }[] | { id: string } | null } | null
  if (!row || row.role !== 'student') return null
  const st = Array.isArray(row.students) ? row.students[0] : row.students
  return st ? { student_id: st.id, full_name: row.full_name } : null
}
