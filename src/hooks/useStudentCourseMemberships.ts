import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentCourseGroupMembership {
  groupId: string
  groupName: string
  groupType: 'individual' | 'pair' | 'group'
  isActive: boolean
}

export interface StudentCourseMembership {
  courseId: string
  courseTitle: string
  courseSubject: string | null
  courseExamType: string | null
  /** Курс снят с ведения (`courses.is_active = false`) — зачисление при этом осталось. */
  courseActive: boolean
  groups: StudentCourseGroupMembership[]
}

/**
 * Real source of truth for a student's course access: group_students -> groups -> courses.
 * Deliberately not student_courses (legacy, disconnected from actual group membership).
 * RLS on group_students/groups already scopes results to the viewing teacher (or admin/owner) --
 * no extra teacher_id filter needed here, so another teacher's groups for the same student
 * never leak into this query's result set.
 *
 * §123. Зачисления НЕ отбрасываются по `is_active`.
 *
 * Раньше строки с `courses.is_active = false` (а на проде такими были ВСЕ шесть
 * зачислений) молча выпадали, и одна страница противоречила сама себе: плашка
 * в шапке показывала группу и курс, а блок ниже писал «Ученик не записан ни на
 * один курс» и предлагал распределить — то есть предлагал починить то, что не
 * сломано. Архивный курс — это состояние курса, а не отсутствие зачисления;
 * отдаём флаг и помечаем в интерфейсе.
 */
export function useStudentCourseMemberships(studentId: string | undefined) {
  const [courses, setCourses] = useState<StudentCourseMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('group_students')
      .select('group_id, groups(id, name, type, is_active, course_id, courses(id, title, subject, exam_type, is_active))')
      .eq('student_id', studentId)
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const byCourse = new Map<string, StudentCourseMembership>()
        for (const row of (data || []) as any[]) {
          const g = row.groups
          const c = g?.courses
          // Отбрасываем только то, у чего вообще нет курса или группы: это
          // битая строка. Неактивность — не повод спрятать зачисление.
          if (!g || !c) continue
          const courseId = c.id as string
          if (!byCourse.has(courseId)) {
            byCourse.set(courseId, {
              courseId,
              courseTitle: c.title || 'Без названия',
              courseActive: Boolean(c.is_active),
              courseSubject: c.subject || null,
              courseExamType: c.exam_type || null,
              groups: [],
            })
          }
          byCourse.get(courseId)!.groups.push({
            groupId: g.id,
            groupName: g.name || '—',
            groupType: g.type || 'group',
            isActive: Boolean(g.is_active),
          })
        }
        setCourses(Array.from(byCourse.values()))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [studentId, tick])

  return { courses, loading, error, reload }
}
