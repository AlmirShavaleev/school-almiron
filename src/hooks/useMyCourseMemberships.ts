import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface MyCourseGroupMembership {
  groupId: string
  groupTitle: string
  groupType: 'individual' | 'pair' | 'group'
}

export interface MyCourseMembership {
  courseId: string
  title: string
  subject: string | null
  examType: string | null
  /** All active groups the student is in for this course (individual + mini-group both possible). */
  groups: MyCourseGroupMembership[]
  /** First group, for a single "open this course" action when the student picks the course itself
   *  rather than a specific group. */
  primaryGroupId: string
}

/**
 * Real source of the CURRENT student's own course access: group_students -> groups -> courses,
 * scoped to auth.uid() via RLS (group_students_select_own / groups_select_all's
 * auth_is_student_in_group / courses_select_scoped's auth_is_student_in_group) -- no explicit
 * student_id filter needed or possible from the client side, and none is added here. Deliberately
 * not student_courses: that table is legacy and isn't populated by the group-based onboarding/
 * distribution flow, which is why the old CourseSelector showed nothing for these students.
 */
export function useMyCourseMemberships() {
  const [courses, setCourses] = useState<MyCourseMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: authData } = await supabase.auth.getUser()
      const uid = authData?.user?.id
      if (!uid) {
        if (!cancelled) { setCourses([]); setLoading(false) }
        return
      }

      const { data: student } = await supabase.from('students').select('id').eq('profile_id', uid).maybeSingle()
      if (!student) {
        if (!cancelled) { setCourses([]); setLoading(false) }
        return
      }

      const { data, error: err } = await supabase
        .from('group_students')
        .select('group_id, groups(id, name, type, is_active, course_id, courses(id, title, subject, exam_type, is_active))')
        .eq('student_id', student.id)

      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const byCourse = new Map<string, MyCourseMembership>()
      for (const row of (data || []) as any[]) {
        const g = row.groups
        const c = g?.courses
        if (!g || !c || !g.is_active || !c.is_active) continue
        const courseId = c.id as string
        if (!byCourse.has(courseId)) {
          byCourse.set(courseId, {
            courseId,
            title: c.title || 'Без названия',
            subject: c.subject || null,
            examType: c.exam_type || null,
            groups: [],
            primaryGroupId: g.id,
          })
        }
        byCourse.get(courseId)!.groups.push({
          groupId: g.id,
          groupTitle: g.name || '—',
          groupType: g.type || 'group',
        })
      }
      setCourses(Array.from(byCourse.values()))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [tick])

  return { courses, loading, error, reload }
}
