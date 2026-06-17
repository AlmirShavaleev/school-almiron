import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentCourse {
  id:          string
  student_id:  string
  course_id:   string
  status:      'active' | 'expired' | 'cancelled' | 'trial'
  source:      'purchase' | 'manual' | 'trial' | 'gift'
  enrolled_at: string
  expires_at:  string | null
  notes:       string | null
  // joined course fields
  course_title:       string
  course_subject:     string | null
  course_exam_type:   string | null
  course_description: string | null
  course_start_date:  string | null
  course_end_date:    string | null
}

const ACTIVE_KEY = (studentId: string) => `almiron:active-course:${studentId}`

export function useStudentCourses(studentId: string | undefined) {
  const [courses,        setCourses]        = useState<StudentCourse[]>([])
  const [loading,        setLoading]        = useState(true)
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null)
  const [tick,           setTick]           = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    supabase.from('student_courses')
      .select(`
        id, student_id, course_id, status, source, enrolled_at, expires_at, notes,
        courses(title, subject, exam_type, description, start_date, end_date)
      `)
      .eq('student_id', studentId)
      .order('enrolled_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        const built: StudentCourse[] = (data || []).map((r: any) => ({
          id:          r.id,
          student_id:  r.student_id,
          course_id:   r.course_id,
          status:      r.status,
          source:      r.source,
          enrolled_at: r.enrolled_at,
          expires_at:  r.expires_at,
          notes:       r.notes,
          course_title:       r.courses?.title || '—',
          course_subject:     r.courses?.subject || null,
          course_exam_type:   r.courses?.exam_type || null,
          course_description: r.courses?.description || null,
          course_start_date:  r.courses?.start_date || null,
          course_end_date:    r.courses?.end_date || null,
        }))
        setCourses(built)

        // Pick saved active or first active enrollment
        const saved = localStorage.getItem(ACTIVE_KEY(studentId))
        const stillValid = built.find(c => c.id === saved)
        if (stillValid) {
          setActiveCourseId(saved)
        } else {
          const firstActive = built.find(c => c.status === 'active') || built[0]
          setActiveCourseId(firstActive?.id || null)
          if (firstActive) localStorage.setItem(ACTIVE_KEY(studentId), firstActive.id)
        }

        setLoading(false)
      })

    return () => { cancelled = true }
  }, [studentId, tick])

  const setActive = useCallback((enrollmentId: string) => {
    if (!studentId) return
    setActiveCourseId(enrollmentId)
    localStorage.setItem(ACTIVE_KEY(studentId), enrollmentId)
  }, [studentId])

  const activeEnrollment = courses.find(c => c.id === activeCourseId) || null
  const activeCourses    = courses.filter(c => c.status === 'active')

  // ── Admin actions ─────────────────────────────────────────────────────────
  async function enrollStudent(courseId: string, opts?: { expires_at?: string; source?: StudentCourse['source']; notes?: string }) {
    if (!studentId) return { error: new Error('No student') }
    const { error } = await supabase.from('student_courses').insert({
      student_id: studentId,
      course_id:  courseId,
      status:     'active',
      source:     opts?.source || 'manual',
      expires_at: opts?.expires_at || null,
      notes:      opts?.notes || null,
    })
    if (!error) reload()
    return { error }
  }

  async function unenroll(enrollmentId: string) {
    const { error } = await supabase.from('student_courses').delete().eq('id', enrollmentId)
    if (!error) reload()
    return { error }
  }

  async function updateEnrollment(enrollmentId: string, patch: Partial<Pick<StudentCourse, 'status' | 'expires_at' | 'notes'>>) {
    const { error } = await supabase.from('student_courses').update(patch).eq('id', enrollmentId)
    if (!error) reload()
    return { error }
  }

  return {
    courses, activeCourses, activeEnrollment, activeCourseId,
    loading, reload, setActive,
    enrollStudent, unenroll, updateEnrollment,
  }
}
