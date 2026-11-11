import { supabase } from '@/lib/supabase'
export interface Slot { id: string; starts_at: string; is_open?: boolean }
export interface Booking {
 id: string; slot_id: string; starts_at: string; subject: string; question: string;
 status: string; amount_rub: number; reserved_until: string; meeting_url: string | null;
 confirmation_url: string | null; name?: string;
}
export interface CalendarData { enabled: boolean; server_now: string; slots: Slot[]; bookings: Booking[] }
export interface AdminData { settings: { enabled: boolean; meeting_url: string }; slots: Slot[]; bookings: Booking[] }
export async function tutoringRpc<T>(name: string, args = {}): Promise<T> {
 const { data, error } = await supabase.rpc(name as never, args as never)
 if (error) throw new Error(error.message)
 return data as T
}
export async function payment(action: 'checkout' | 'sync', bookingId: string): Promise<{ confirmation_url?: string; status?: string }> {
 const { data, error } = await supabase.functions.invoke('tutoring-payment', { body: { action, booking_id: bookingId, return_origin: window.location.origin } })
 if (error) {
  const detail = await (error as { context?: Response }).context?.json().catch(() => null)
  throw new Error(detail?.error ?? 'Не удалось связаться с оплатой')
 }
 return data
}
export function moscowDate(iso: string) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date(iso)) }
export function moscowTime(iso: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) }
export function moscowFull(iso: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) }
export function canReschedule(booking: Booking, now: number) { return booking.status === 'paid' && new Date(booking.starts_at).getTime() - now >= 2 * 60 * 60 * 1000 }
export const STATUS: Record<string,string> = { pending: 'Ожидает оплаты', paid: 'Запись подтверждена', expired: 'Резерв истёк', canceled: 'Оплата отменена', payment_conflict: 'Нужно согласовать время с преподавателем', refunded: 'Возврат оформлен' }
