import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentCourseCard {
  groupId: string
  courseId: string
  courseTitle: string
  subject: string | null
  /** §255: 'ege' | 'oge' | null — плашка «N дней до ЕГЭ» и карточка прогноза. */
  examType?: string | null
}

interface StudentDashboardData {
  courses: StudentCourseCard[]
  /** students.id текущего пользователя — для журнала ДЗ (карточки курсов). */
  studentId: string | null
  loading: boolean
}

/**
 * Курсы ученика для главной.
 *
 * §254: плитки StatCard, «Последние ДЗ» и «Мои тесты» ушли с главной — их
 * заменили кнопки-счётчики (`studentTodo`) и карточки «Мои курсы»
 * (`studentHome.courseCards`). Хук больше не тянет попытки ДЗ и тестов, а
 * только членство в группах: курсы нужны карточкам и баннеру пробника (§224.2).
 */
export function useStudentDashboard(profileId: string | undefined): StudentDashboardData {
  const [data, setData] = useState<StudentDashboardData>({ courses: [], studentId: null, loading: true })

  useEffect(() => {
    if (!profileId) return
    let cancelled = false

    async function load() {
      try {
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('profile_id', profileId!)
          .maybeSingle()

        if (cancelled) return
        if (!student) { setData({ courses: [], studentId: null, loading: false }); return }

        // Курсы — через group_students → groups → courses.
        const { data: groupStudentsData } = await supabase
          .from('group_students')
          .select('group_id, groups!inner(id, course_id, courses!inner(id, title, subject, exam_type))')
          .eq('student_id', student.id)

        type Row = { groups: { id: string; courses: { id: string; title: string; subject: string | null; exam_type?: string | null } | null } | null }
        const seen = new Map<string, StudentCourseCard>()
        for (const gs of (groupStudentsData ?? []) as unknown as Row[]) {
          const group = gs.groups
          const course = group?.courses
          if (!course?.id || seen.has(course.id)) continue
          seen.set(course.id, {
            groupId: group!.id,
            courseId: course.id,
            courseTitle: course.title,
            subject: course.subject || null,
            examType: course.exam_type ?? null,
          })
        }

        if (!cancelled) setData({ courses: [...seen.values()], studentId: student.id, loading: false })
      } catch (error) {
        console.error('Error loading student dashboard:', error)
        if (!cancelled) setData(d => ({ ...d, loading: false }))
      }
    }

    void load()
    return () => { cancelled = true }
  }, [profileId])

  return data
}
