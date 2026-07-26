import { supabase } from '@/lib/supabase'

export interface InvitationAcceptanceResult {
  inviteId: string
  studentId: string
  groupId: string
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
  if (text.includes('invalid') || text.includes('not found') || text.includes('token') || text.includes('code')) {
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
