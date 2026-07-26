import { supabase } from '@/lib/supabase'

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface SubmitJoinRequestResult {
  requestId: string
  status: JoinRequestStatus
  createdAt: string
}

export interface MyJoinRequest {
  id: string
  studentId: string
  fullName: string
  email: string | null
  status: JoinRequestStatus
  createdAt: string
  reviewedAt: string | null
}

export type JoinRequestErrorKind =
  | 'invalid_link'
  | 'link_inactive'
  | 'wrong_role'
  | 'already_connected'
  | 'request_rejected'
  | 'request_cancelled'
  | 'profile_missing'
  | 'permission'
  | 'not_found'
  | 'unknown'

export class TeacherJoinRequestError extends Error {
  kind: JoinRequestErrorKind
  code: string | null
  constructor(kind: JoinRequestErrorKind, message: string, code: string | null = null) {
    super(message)
    this.name = 'TeacherJoinRequestError'
    this.kind = kind
    this.code = code
  }
}

function mapError(error: unknown): TeacherJoinRequestError {
  const raw = error as { message?: string; code?: string | null }
  const message = raw?.message ?? ''
  const code = raw?.code ?? null

  if (!message) return new TeacherJoinRequestError('unknown', 'Не удалось обработать запрос', code)
  if (message.includes('LINK_INVALID_OR_INACTIVE')) {
    return new TeacherJoinRequestError('link_inactive', 'Ссылка недействительна или отключена. Уточните у преподавателя актуальную ссылку.', code)
  }
  if (message.includes('INVALID_LINK')) {
    return new TeacherJoinRequestError('invalid_link', 'Ссылка недействительна', code)
  }
  if (message.includes('ONLY_STUDENT_CAN_JOIN')) {
    return new TeacherJoinRequestError('wrong_role', 'Эта ссылка предназначена для аккаунта ученика. Выйдите и войдите в ученический аккаунт.', code)
  }
  if (message.includes('ALREADY_CONNECTED')) {
    return new TeacherJoinRequestError('already_connected', 'Вы уже связаны с этим преподавателем', code)
  }
  if (message.includes('REQUEST_REJECTED')) {
    return new TeacherJoinRequestError('request_rejected', 'Ваша предыдущая заявка была отклонена. Обратитесь к преподавателю за новой ссылкой.', code)
  }
  if (message.includes('REQUEST_CANCELLED')) {
    return new TeacherJoinRequestError('request_cancelled', 'Эта заявка была отменена. Обратитесь к преподавателю.', code)
  }
  if (message.includes('PROFILE_MISSING') || message.includes('STUDENT_RECORD_MISSING')) {
    return new TeacherJoinRequestError('profile_missing', 'Не удалось определить профиль ученика. Обратитесь в поддержку.', code)
  }
  if (message.includes('REQUEST_NOT_FOUND')) {
    return new TeacherJoinRequestError('not_found', 'Заявка не найдена', code)
  }
  if (message.includes('FORBIDDEN') || message.includes('permission') || code === '42501') {
    return new TeacherJoinRequestError('permission', 'Недостаточно прав для выполнения действия', code)
  }
  return new TeacherJoinRequestError('unknown', message, code)
}

export async function submitTeacherJoinRequest(token: string): Promise<SubmitJoinRequestResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('submit_teacher_join_request', { p_token: token })
    if (error) throw error
    return {
      requestId: String(data?.request_id ?? ''),
      status: (data?.status ?? 'pending') as JoinRequestStatus,
      createdAt: String(data?.created_at ?? ''),
    }
  } catch (error) {
    throw mapError(error)
  }
}

export async function rejectTeacherJoinRequest(requestId: string): Promise<void> {
  try {
    const db = supabase as any
    const { error } = await db.rpc('reject_teacher_join_request', { p_request_id: requestId })
    if (error) throw error
  } catch (error) {
    throw mapError(error)
  }
}

export async function restoreTeacherJoinRequest(requestId: string): Promise<void> {
  try {
    const db = supabase as any
    const { error } = await db.rpc('restore_teacher_join_request', { p_request_id: requestId })
    if (error) throw error
  } catch (error) {
    throw mapError(error)
  }
}

export async function getMyJoinRequests(status?: JoinRequestStatus | null): Promise<MyJoinRequest[]> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('get_my_join_requests', { p_status: status ?? null })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    return rows.map((row: any) => ({
      id: String(row.id ?? ''),
      studentId: String(row.student_id ?? ''),
      fullName: String(row.full_name ?? '—'),
      email: row.email ? String(row.email) : null,
      status: (row.status ?? 'pending') as JoinRequestStatus,
      createdAt: String(row.created_at ?? ''),
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    }))
  } catch (error) {
    throw mapError(error)
  }
}
