import { supabase } from '@/lib/supabase'

/**
 * The exact group/course/staff projection used by the student's course page.
 * Reuse it on "My courses" so a just-opened course can reuse the RLS-checked
 * group row instead of repeating the same membership query immediately.
 */
export const STUDENT_GROUP_WITH_COURSE_SELECT = `
  id, name, course_id,
  courses(id, title, subject, exam_type, is_template),
  teachers(id, profiles(id, full_name, email, phone, avatar_url)),
  curators(id, profiles(id, full_name, email, phone, avatar_url))
`

export interface StudentGroupWithCourse {
  id: string
  name: string
  course_id: string | null
  courses: {
    id: string
    title: string
    subject: string
    exam_type: string
    is_template?: boolean
  } | null
  teachers?: unknown
  curators?: unknown
}
export interface StudentMembershipRow {
  group_id: string
  groups: StudentGroupWithCourse | null
}

// Only short-lived membership metadata. Never cache subscriptions, submission
// status or lesson progress: their freshness is important for access and grading.
const MEMBERSHIP_CACHE_MS = 8_000
interface CacheEntry {
  expiresAt: number
  inFlight: boolean
  rows: StudentMembershipRow[] | null
  promise: Promise<StudentMembershipRow[] | null>
}
const cache = new Map<string, CacheEntry>()
const keyFor = (profileId: string, studentId: string) => `${profileId}:${studentId}`

/** Group list for one authenticated student; deduplicates concurrent reads and short revisits. */
export function loadStudentGroupMemberships(profileId: string, studentId: string): Promise<StudentMembershipRow[] | null> {
  const key = keyFor(profileId, studentId)
  const old = cache.get(key)
  // While the backend is slow, keep deduplicating even after the TTL.
  if (old && (old.inFlight || Date.now() < old.expiresAt)) return old.promise
  const entry: CacheEntry = { expiresAt: Date.now() + MEMBERSHIP_CACHE_MS, inFlight: true, rows: null, promise: Promise.resolve(null) }
  entry.promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('group_students')
        .select(`group_id, groups(${STUDENT_GROUP_WITH_COURSE_SELECT})`)
        .eq('student_id', studentId)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as StudentMembershipRow[]
      entry.inFlight = false
      // Do not keep a negative cache: students may just have joined their first course.
      if (cache.get(key) === entry) {
        if (rows.length) { entry.rows = rows; entry.expiresAt = Date.now() + MEMBERSHIP_CACHE_MS }
        else cache.delete(key)
      }
      return rows
    } catch {
      entry.inFlight = false
      if (cache.get(key) === entry) cache.delete(key)
      return null
    }
  })()
  cache.set(key, entry)
  return entry.promise
}

/** Reuse only a previously loaded list for this same profile and student. */
export function getCachedStudentCourseGroup(profileId: string, studentId: string, groupId: string): StudentGroupWithCourse | null {
  const entry = cache.get(keyFor(profileId, studentId))
  if (!entry || !entry.rows || Date.now() >= entry.expiresAt) return null
  const group = entry.rows.find(row => row.group_id === groupId)?.groups
  return group?.id === groupId && group.course_id ? group : null
}

/** Course join/change and test cleanup may invalidate the short-lived snapshot. */
export function resetStudentGroupMembershipsCache(): void {
  cache.clear()
}

// Tests call this without importing the module early (which would bypass mocks).
;(globalThis as { __resetStudentGroupMembershipsCache?: () => void }).__resetStudentGroupMembershipsCache = resetStudentGroupMembershipsCache
