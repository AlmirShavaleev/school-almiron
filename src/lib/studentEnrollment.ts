import { supabase } from '@/lib/supabase'

export type InviteStatus =
  | 'pending'
  | 'revoked'
  | 'accepted'
  | 'expired'
  | 'invite_created'
  | 'duplicate_in_batch'
  | 'active_invite_exists'
  | 'already_enrolled'
  | 'invalid_data'
  | 'group_capacity_reached'

export interface StudentInviteCreateParams {
  groupId: string
  fullName: string
  email?: string | null
  phone?: string | null
  classGrade?: string | null
}

export interface StudentInviteResult {
  inviteId: string
  token: string
  shortCode: string
  expiresAt: string
}

export interface StudentInviteBatchRowInput {
  clientRowId: string
  fullName: string
  classGrade?: string | null
  email?: string | null
  phone?: string | null
}

export interface StudentInviteBatchParams {
  groupId: string
  title?: string | null
  rows: StudentInviteBatchRowInput[]
}

export interface StudentInviteBatchItem {
  clientRowId: string
  inviteId: string | null
  status: InviteStatus | string
  token: string | null
  shortCode: string | null
  expiresAt: string | null
  error: string | null
}

export interface StudentInviteBatchResult {
  batchId: string
  items: StudentInviteBatchItem[]
}

export interface MyStudent {
  studentId: string | null
  profileId: string | null
  fullName: string
  classGrade: string | null
  groups: Array<{ id: string; name: string }>
  courses: Array<{ id: string; title: string }>
  relationStatus: string | null
  addedAt: string | null
}

export interface MyStudentInvite {
  inviteId: string
  groupId: string | null
  groupName: string | null
  batchId: string | null
  fullName: string
  classGrade: string | null
  email: string | null
  phone: string | null
  status: InviteStatus | string
  createdAt: string | null
  expiresAt: string | null
}

export interface GetMyStudentInvitesParams {
  groupId?: string | null
  status?: string | null
  batchId?: string | null
}

export class StudentEnrollmentError extends Error {
  code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'StudentEnrollmentError'
    this.code = code
  }
}

function toMessage(error: unknown): StudentEnrollmentError {
  if (error instanceof StudentEnrollmentError) return error
  const raw = error as { message?: string; code?: string | null; details?: string | null }
  const message = raw?.message ?? 'Не удалось выполнить действие'
  const code = raw?.code ?? null

  if (message.includes('permission') || code === '42501') {
    return new StudentEnrollmentError('Недостаточно прав для выполнения действия', code)
  }
  if (message.includes('group_capacity_reached')) {
    return new StudentEnrollmentError('В выбранной группе больше нет свободных мест', code)
  }
  if (message.includes('active_invite_exists')) {
    return new StudentEnrollmentError('Для этого ученика уже есть активное приглашение', code)
  }
  if (message.includes('already_enrolled')) {
    return new StudentEnrollmentError('Ученик уже зачислен в выбранную группу', code)
  }

  return new StudentEnrollmentError(message, code)
}

function expectRecord(value: unknown, fallbackMessage: string): Record<string, any> {
  if (!value || typeof value !== 'object') {
    throw new StudentEnrollmentError(fallbackMessage)
  }
  return value as Record<string, any>
}

function mapInviteResult(row: Record<string, any>): StudentInviteResult {
  return {
    inviteId: String(row.invite_id ?? ''),
    token: String(row.token ?? ''),
    shortCode: String(row.short_code ?? ''),
    expiresAt: String(row.expires_at ?? ''),
  }
}

export function buildInviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/join/${token}`
}

export function buildInviteMessage(token: string, shortCode: string): string {
  const url = buildInviteUrl(token)
  return [
    'Здравствуйте! Для присоединения к School Almiron перейдите по ссылке:',
    url,
    '',
    'Или откройте страницу присоединения и введите код:',
    shortCode,
    '',
    'Приглашение действительно 14 дней.',
  ].join('\n')
}

export async function createStudentInvite(params: StudentInviteCreateParams): Promise<StudentInviteResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('create_student_invite', {
      p_group_id: params.groupId,
      p_full_name: params.fullName,
      p_email: params.email ?? null,
      p_phone: params.phone ?? null,
      p_class_grade: params.classGrade ?? null,
    })
    if (error) throw error
    return mapInviteResult(expectRecord(data, 'Приглашение не было создано'))
  } catch (error) {
    throw toMessage(error)
  }
}

export async function createStudentInviteBatch(params: StudentInviteBatchParams): Promise<StudentInviteBatchResult> {
  try {
    const db = supabase as any
    const payloadRows = params.rows.map(row => ({
      client_row_id: row.clientRowId,
      full_name: row.fullName,
      class_grade: row.classGrade ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
    }))
    const { data, error } = await db.rpc('create_student_invite_batch', {
      p_group_id: params.groupId,
      p_rows: payloadRows,
      p_title: params.title ?? null,
    })
    if (error) throw error
    const payload = expectRecord(data, 'Пакет приглашений не был создан')
    const items = Array.isArray(payload.items) ? payload.items : []
    return {
      batchId: String(payload.batch_id ?? ''),
      items: items.map((item: any) => ({
        clientRowId: String(item.client_row_id ?? ''),
        inviteId: item.invite_id ? String(item.invite_id) : null,
        status: String(item.status ?? 'unknown'),
        token: item.token ? String(item.token) : null,
        shortCode: item.short_code ? String(item.short_code) : null,
        expiresAt: item.expires_at ? String(item.expires_at) : null,
        error: item.error ? String(item.error) : null,
      })),
    }
  } catch (error) {
    throw toMessage(error)
  }
}

export async function revokeStudentInvite(inviteId: string): Promise<void> {
  try {
    const db = supabase as any
    const { error } = await db.rpc('revoke_student_invite', { p_invite_id: inviteId })
    if (error) throw error
  } catch (error) {
    throw toMessage(error)
  }
}

export async function reissueStudentInvite(inviteId: string): Promise<StudentInviteResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('reissue_student_invite', { p_invite_id: inviteId })
    if (error) throw error
    return mapInviteResult(expectRecord(data, 'Приглашение не было перевыпущено'))
  } catch (error) {
    throw toMessage(error)
  }
}

export async function reissueStudentInviteBatch(batchId: string): Promise<StudentInviteBatchItem[]> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('reissue_student_invite_batch', { p_batch_id: batchId })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    return rows.map((item: any) => ({
      clientRowId: String(item.client_row_id ?? ''),
      inviteId: item.invite_id ? String(item.invite_id) : null,
      status: String(item.status ?? 'unknown'),
      token: item.token ? String(item.token) : null,
      shortCode: item.short_code ? String(item.short_code) : null,
      expiresAt: item.expires_at ? String(item.expires_at) : null,
      error: item.error ? String(item.error) : null,
    }))
  } catch (error) {
    throw toMessage(error)
  }
}

export async function getMyStudents(): Promise<MyStudent[]> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('get_my_students')
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    return rows.map((row: any) => ({
      studentId: row.student_id ? String(row.student_id) : null,
      profileId: row.profile_id ? String(row.profile_id) : null,
      fullName: String(row.full_name ?? '—'),
      classGrade: row.class_grade ? String(row.class_grade) : null,
      groups: Array.isArray(row.groups)
        ? row.groups.map((group: any) => ({ id: String(group.id ?? ''), name: String(group.name ?? '—') }))
        : [],
      courses: Array.isArray(row.courses)
        ? row.courses.map((course: any) => ({ id: String(course.id ?? ''), title: String(course.title ?? '—') }))
        : [],
      relationStatus: row.relation_status ? String(row.relation_status) : null,
      addedAt: row.added_at ? String(row.added_at) : null,
    }))
  } catch (error) {
    throw toMessage(error)
  }
}

export async function getMyStudentInvites(params: GetMyStudentInvitesParams = {}): Promise<MyStudentInvite[]> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('get_my_student_invites', {
      p_group_id: params.groupId ?? null,
      p_status: params.status ?? null,
      p_batch_id: params.batchId ?? null,
    })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    return rows.map((row: any) => ({
      inviteId: String(row.invite_id ?? ''),
      groupId: row.group_id ? String(row.group_id) : null,
      groupName: row.group_name ? String(row.group_name) : null,
      batchId: row.batch_id ? String(row.batch_id) : null,
      fullName: String(row.full_name ?? '—'),
      classGrade: row.class_grade ? String(row.class_grade) : null,
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      status: String(row.status ?? 'unknown'),
      createdAt: row.created_at ? String(row.created_at) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
    }))
  } catch (error) {
    throw toMessage(error)
  }
}
