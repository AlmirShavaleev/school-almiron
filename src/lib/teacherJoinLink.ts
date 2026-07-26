import { supabase } from '@/lib/supabase'

export interface TeacherJoinLinkResult {
  linkId: string
  isNew: boolean
  /** raw token of the caller's own active link -- server returns it on every call, not just on creation/rotation */
  token: string | null
  createdAt: string
}

export class TeacherJoinLinkError extends Error {
  code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'TeacherJoinLinkError'
    this.code = code
  }
}

function mapError(error: unknown): TeacherJoinLinkError {
  const raw = error as { message?: string; code?: string | null }
  const message = raw?.message ?? 'Не удалось выполнить действие'
  if (message.includes('ONLY_TEACHER_HAS_JOIN_LINK')) {
    return new TeacherJoinLinkError('Ссылка регистрации доступна только преподавателю', raw?.code)
  }
  if (message.includes('TEACHER_ROW_MISSING')) {
    return new TeacherJoinLinkError('Профиль преподавателя не найден', raw?.code)
  }
  if (message.includes('permission') || raw?.code === '42501') {
    return new TeacherJoinLinkError('Недостаточно прав для выполнения действия', raw?.code)
  }
  return new TeacherJoinLinkError(message, raw?.code)
}

function mapResult(data: any): TeacherJoinLinkResult {
  return {
    linkId: String(data?.link_id ?? ''),
    isNew: Boolean(data?.is_new),
    token: data?.token ? String(data.token) : null,
    createdAt: String(data?.created_at ?? ''),
  }
}

export function buildTeacherJoinUrl(token: string | null | undefined): string {
  if (!token) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/jt/${encodeURIComponent(token)}`
}

export async function createOrGetTeacherJoinLink(): Promise<TeacherJoinLinkResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('create_or_get_teacher_join_link')
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}

export async function rotateTeacherJoinLink(): Promise<TeacherJoinLinkResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('rotate_teacher_join_link')
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}

export async function disableTeacherJoinLink(): Promise<void> {
  try {
    const db = supabase as any
    const { error } = await db.rpc('disable_teacher_join_link')
    if (error) throw error
  } catch (error) {
    throw mapError(error)
  }
}
