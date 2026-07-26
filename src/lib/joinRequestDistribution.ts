import { supabase } from '@/lib/supabase'

export type DistributionMode = 'individual' | 'existing_group' | 'new_group'

export interface DistributionAssignmentInput {
  courseId: string
  mode: DistributionMode
  groupId?: string
  title?: string | null
  maxStudents?: number
  scheduleDays?: string[]
  scheduleTime?: string | null
}

export interface DistributionAssignmentResult {
  courseId: string
  groupId: string
  mode: DistributionMode | 'already_assigned'
  groupCreated: boolean
  alreadyAssigned: boolean
}

export interface DistributeJoinRequestResult {
  joinRequestId: string
  studentId: string
  teacherStudentId: string
  assignments: DistributionAssignmentResult[]
  status: string
}

export class DistributionError extends Error {
  code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'DistributionError'
    this.code = code
  }
}

function mapError(error: unknown): DistributionError {
  const raw = error as { message?: string; code?: string | null }
  const message = raw?.message ?? ''
  const code = raw?.code ?? null

  if (message.includes('permission') || code === '42501') {
    return new DistributionError('Недостаточно прав для выполнения действия', code)
  }
  if (message.includes('GROUP_ALREADY_FULL')) {
    return new DistributionError('В выбранной группе больше нет свободных мест', code)
  }
  if (message.includes('REQUEST_ALREADY_PROCESSED')) {
    return new DistributionError('Эта заявка уже обработана', code)
  }
  if (message.includes('JOIN_REQUEST_NOT_FOUND')) {
    return new DistributionError('Заявка не найдена', code)
  }
  if (message.includes('FORBIDDEN: not your join request')) {
    return new DistributionError('Эта заявка принадлежит другому преподавателю', code)
  }
  if (message.includes('FORBIDDEN: not your group')) {
    return new DistributionError('Эта группа вам не принадлежит', code)
  }
  if (message.includes('FORBIDDEN: not your student')) {
    return new DistributionError('Этот ученик не связан с вами', code)
  }
  if (message.includes('COURSE_NOT_AVAILABLE')) {
    return new DistributionError('Выбранный курс недоступен', code)
  }
  if (message.includes('GROUP_COURSE_MISMATCH')) {
    return new DistributionError('Группа не соответствует выбранному курсу', code)
  }
  if (message.includes('GROUP_NOT_ACTIVE')) {
    return new DistributionError('Выбранная группа неактивна', code)
  }
  if (message.includes('GROUP_NOT_FOUND')) {
    return new DistributionError('Группа не найдена', code)
  }
  if (message.includes('STUDENT_MISSING')) {
    return new DistributionError('Не удалось определить профиль ученика', code)
  }
  if (message.includes('NO_ASSIGNMENTS')) {
    return new DistributionError('Выберите хотя бы один курс', code)
  }
  if (message.includes('MAX_STUDENTS_REQUIRED')) {
    return new DistributionError('Укажите максимальное количество учеников', code)
  }
  if (message.includes('DUPLICATE_COURSE_IN_REQUEST')) {
    return new DistributionError('Один и тот же курс выбран дважды', code)
  }
  if (message.includes('INVALID_ASSIGNMENT')) {
    return new DistributionError('Некорректные данные распределения', code)
  }
  return new DistributionError('Не удалось распределить ученика', code)
}

function toAssignmentPayload(a: DistributionAssignmentInput): Record<string, unknown> {
  const base: Record<string, unknown> = { course_id: a.courseId, mode: a.mode }
  if (a.mode === 'existing_group') base.group_id = a.groupId
  if (a.mode === 'new_group') {
    base.title = a.title ?? null
    base.max_students = a.maxStudents
    if (a.scheduleDays && a.scheduleDays.length > 0) base.schedule_days = a.scheduleDays
    if (a.scheduleTime) base.schedule_time = a.scheduleTime
  }
  return base
}

function mapResult(data: any): DistributeJoinRequestResult {
  const assignments = Array.isArray(data?.assignments) ? data.assignments : []
  return {
    joinRequestId: String(data?.join_request_id ?? ''),
    studentId: String(data?.student_id ?? ''),
    teacherStudentId: String(data?.teacher_student_id ?? ''),
    status: String(data?.status ?? ''),
    assignments: assignments.map((row: any) => ({
      courseId: String(row.course_id ?? ''),
      groupId: String(row.group_id ?? ''),
      mode: row.mode,
      groupCreated: Boolean(row.group_created),
      alreadyAssigned: Boolean(row.already_assigned),
    })),
  }
}

export interface TeacherCourseOption {
  id: string
  title: string
}

/** Active, non-draft courses owned by the current teacher -- source list for the distribution wizard. */
export async function getMyActiveCourses(ownerId: string): Promise<TeacherCourseOption[]> {
  try {
    const db = supabase as any
    const { data, error } = await db
      .from('courses')
      .select('id, title')
      .eq('owner_id', ownerId)
      .eq('is_active', true)
      .eq('is_draft', false)
      .order('title')
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    return rows.map((row: any) => ({ id: String(row.id), title: String(row.title ?? 'Без названия') }))
  } catch (error) {
    throw mapError(error)
  }
}

export async function distributeJoinRequest(
  joinRequestId: string,
  assignments: DistributionAssignmentInput[],
  requestId: string,
): Promise<DistributeJoinRequestResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('distribute_join_request', {
      p_join_request_id: joinRequestId,
      p_assignments: assignments.map(toAssignmentPayload),
      p_request_id: requestId,
    })
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}

/**
 * Same course/group assignment matrix as distributeJoinRequest, for a student who is already
 * an active teacher_students member (no pending join request exists to key off of). Does not
 * touch teacher_join_requests or student_courses.
 */
export async function distributeStudentCourses(
  studentId: string,
  assignments: DistributionAssignmentInput[],
  requestId: string,
): Promise<DistributeJoinRequestResult> {
  try {
    const db = supabase as any
    const { data, error } = await db.rpc('distribute_student_courses', {
      p_student_id: studentId,
      p_assignments: assignments.map(toAssignmentPayload),
      p_request_id: requestId,
    })
    if (error) throw error
    return mapResult(data)
  } catch (error) {
    throw mapError(error)
  }
}
