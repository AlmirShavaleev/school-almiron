import { format, formatDistanceToNow, isAfter, isPast } from 'date-fns'
import { ru } from 'date-fns/locale'

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'd MMM yyyy', { locale: ru })
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'd MMM yyyy, HH:mm', { locale: ru })
}

export function formatTime(date: string | Date): string {
  return format(new Date(date), 'HH:mm', { locale: ru })
}

export function timeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { locale: ru, addSuffix: true })
}

export function isOverdue(date: string | Date): boolean {
  return isPast(new Date(date))
}

export function isUpcoming(date: string | Date): boolean {
  return isAfter(new Date(date), new Date())
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount)
}

export const LEAGUE_LABELS: Record<string, string> = {
  bronze: 'Бронза',
  silver: 'Серебро',
  gold: 'Золото',
  platinum: 'Платина',
  academic: 'Академик',
}

export const LEAGUE_COLORS: Record<string, string> = {
  bronze: 'text-amber-700 bg-amber-100',
  silver: 'text-slate-600 bg-slate-100',
  gold: 'text-yellow-700 bg-yellow-100',
  platinum: 'text-indigo-700 bg-indigo-100',
  academic: 'text-purple-700 bg-purple-100',
}

export const ROLE_LABELS: Record<string, string> = {
  student: 'Ученик',
  parent:  'Родитель',
  teacher: 'Преподаватель',
  curator: 'Куратор',
  admin:   'Администратор',
  owner:   'Владелец',
}

export const SUBJECT_LABELS: Record<string, string> = {
  physics: 'Физика',
  math: 'Математика',
}

export const EXAM_LABELS: Record<string, string> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
}

export const HW_STATUS_LABELS: Record<string, string> = {
  not_submitted: 'Не сдано',
  submitted: 'На проверке',
  checked: 'Проверено',
  revision: 'На доработке',
}

export const HW_STATUS_COLORS: Record<string, string> = {
  not_submitted: 'text-red-700 bg-red-100',
  submitted: 'text-blue-700 bg-blue-100',
  checked: 'text-green-700 bg-green-100',
  revision: 'text-orange-700 bg-orange-100',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает оплаты',
  paid: 'Оплачено',
  overdue: 'Просрочено',
  refunded: 'Возврат',
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-700 bg-yellow-100',
  paid: 'text-green-700 bg-green-100',
  overdue: 'text-red-700 bg-red-100',
  refunded: 'text-gray-700 bg-gray-100',
}
