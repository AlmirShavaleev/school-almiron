import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'

export interface InvitationAcceptanceResult {
  inviteId: string
  studentId: string
  groupId: string
}

export interface CourseJoinAccepted {
  groupId: string | null
  courseId: string
  courseTitle: string
  joinedAs: 'student' | 'curator'
}

export type InvitationErrorKind =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'wrong_role'
  | 'email_unconfirmed'
  | 'group_unavailable'
  | 'group_full'
  | 'network'
  | 'unknown'

export class InvitationAcceptanceError extends Error {
  kind: InvitationErrorKind

  constructor(kind: InvitationErrorKind, message: string) {
    super(message)
    this.name = 'InvitationAcceptanceError'
    this.kind = kind
  }
}

function mapError(error: unknown): InvitationAcceptanceError {
  const raw = error as { message?: string; code?: string }
  const text = `${raw?.code ?? ''} ${raw?.message ?? ''}`.toLowerCase()

  if (!raw?.message) return new InvitationAcceptanceError('unknown', 'Не удалось обработать приглашение')
  if (text.includes('fetch') || text.includes('network')) return new InvitationAcceptanceError('network', 'Нет соединения. Проверьте интернет и попробуйте снова.')
  if (text.includes('email') && text.includes('confirm')) return new InvitationAcceptanceError('email_unconfirmed', 'Подтвердите email, затем вернитесь к приглашению.')
  if (text.includes('teacher') || text.includes('admin') || text.includes('owner') || text.includes('curator') || text.includes('parent') || text.includes('student account')) {
    return new InvitationAcceptanceError('wrong_role', 'Это приглашение предназначено для аккаунта ученика. Выйдите и войдите в ученический аккаунт.')
  }
  if (text.includes('expired')) return new InvitationAcceptanceError('expired', 'Срок действия приглашения истёк. Обратитесь к преподавателю за новой ссылкой.')
  if (text.includes('invite_not_pending')) {
    if (text.includes('accepted')) return new InvitationAcceptanceError('used', 'Это приглашение уже использовано.')
    if (text.includes('revoked')) return new InvitationAcceptanceError('revoked', 'Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.')
    return new InvitationAcceptanceError('unknown', 'Не удалось обработать приглашение')
  }
  if (text.includes('revoked')) return new InvitationAcceptanceError('revoked', 'Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.')
  if (text.includes('already used') || text.includes('already accepted') || text.includes('used')) {
    return new InvitationAcceptanceError('used', 'Это приглашение уже использовано.')
  }
  if (text.includes('capacity') || text.includes('full')) {
    return new InvitationAcceptanceError('group_full', 'В этой группе больше нет свободных мест.')
  }
  if (text.includes('group') && (text.includes('not found') || text.includes('inactive') || text.includes('unavailable'))) {
    return new InvitationAcceptanceError('group_unavailable', 'Группа больше недоступна.')
  }
  // Легаси-RPC поднимают SQLSTATE-исключения машинными кодами через underscore:
  // `INVITE_NOT_FOUND`, `INVALID_CODE`. postgrest-js отдаёт их как
  // { code: 'P0001', message: 'INVITE_NOT_FOUND' } → склейка выше даёт
  // 'p0001 invite_not_found', где нет подстроки 'not found' (там underscore).
  // Именно из-за этого курсовые токены получали kind='unknown' и никогда не
  // доходили до course_join_accept — поэтому проверяем оба написания.
  if (text.includes('invalid') || text.includes('not found') || text.includes('not_found') || text.includes('token') || text.includes('code')) {
    return new InvitationAcceptanceError('invalid', 'Ссылка или код приглашения недействительны.')
  }

  return new InvitationAcceptanceError('unknown', 'Не удалось обработать приглашение')
}

function mapResult(data: any): InvitationAcceptanceResult {
  // accept_student_invite* are TABLE-returning RPCs -> supabase yields an array of rows.
  const row = Array.isArray(data) ? data[0] : data
  return {
    inviteId: String(row?.invite_id ?? ''),
    studentId: String(row?.student_id ?? ''),
    groupId: String(row?.group_id ?? ''),
  }
}

export async function acceptStudentInvite(token: string): Promise<InvitationAcceptanceResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('accept_student_invite', { p_token: token })
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}

export async function acceptStudentInviteByCode(shortCode: string): Promise<InvitationAcceptanceResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('accept_student_invite_by_code', { p_short_code: shortCode })
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}

/**
 * Гарантирует, что у текущего пользователя есть строка в `profiles`.
 *
 * Зачем: регистрация по приглашению идёт с `skipProfileInsert: true`
 * (RegisterPage), а триггера на `auth.users` в схеме нет. Если профиля нет,
 * `course_join_accept` читает `v_role = NULL` и падает на
 * `v_role is distinct from 'student'` сообщением «По этой ссылке присоединяются
 * только ученики» — ровно этот отказ и наблюдался в проде.
 *
 * Основную вставку делает AppAuth.loadProfile, как только появилась сессия
 * (там же объяснение, почему раньше нельзя — RLS требует `id = auth.uid()`).
 * Здесь — вторая линия защиты ровно перед RPC: сессия могла появиться в обход
 * loadProfile (другая вкладка, гонка с редиректом подтверждения почты), а
 * вставка там могла не успеть или молча упасть. Вызов идемпотентен, поэтому
 * дублирование безопасно и стоит один SELECT.
 *
 * RLS `profiles_insert_admin` разрешает вставку только своей строки
 * (`id = auth.uid()`) — вставляем ровно её с ролью student, единственной, на
 * которую пользователь имеет право сам себя записать.
 * Существующий профиль не трогаем (даже с ролью не student): решение о том,
 * годится ли роль, принимает RPC и выдаёт осмысленную ошибку.
 */
export async function ensureStudentProfile(): Promise<Profile | null> {
  const db = supabase as any
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) return null

  const { data: existing } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (existing) return existing as Profile

  const email: string = user.email ?? ''
  // profiles.full_name — NOT NULL, а в invite-режиме ФИО не спрашивают.
  // Порядок: метаданные регистрации → локальная часть email → заглушка.
  const metaName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''
  const fullName = metaName || email.split('@')[0] || 'Ученик'

  const { data: inserted, error } = await db
    .from('profiles')
    .insert({ id: user.id, email, full_name: fullName, role: 'student' })
    .select('*')
    .maybeSingle()
  if (!error && inserted) return inserted as Profile

  // Гонка с параллельной вставкой (легаси-путь, второй таб) или отказ RLS —
  // перечитываем: если профиль всё-таки есть, продолжаем как ни в чём не бывало.
  const { data: after } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (after) return after as Profile
  if (error) {
    throw new InvitationAcceptanceError('unknown', 'Не удалось создать профиль ученика. Обновите страницу и попробуйте снова.')
  }
  return null
}

export async function acceptCourseJoin(value: string): Promise<CourseJoinAccepted> {
  try {
    // course_join_accept требует профиль с ролью student — см. ensureStudentProfile.
    await ensureStudentProfile()
    const db = supabase as any
    const { data, error } = await db.rpc('course_join_accept', { p_value: value })
    if (error) throw error
    // course_join_accept is a TABLE-returning RPC -> data is an array
    const row = Array.isArray(data) ? data[0] : data
    return {
      groupId: row?.group_id ?? null,
      courseId: String(row?.course_id ?? ''),
      courseTitle: String(row?.course_title ?? ''),
      joinedAs: row?.joined_as ?? 'student',
    }
  } catch (error) {
    throw new Error((error as any)?.message ?? 'Не удалось обработать приглашение')
  }
}
