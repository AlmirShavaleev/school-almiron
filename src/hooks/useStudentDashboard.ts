import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentCourseCard {
  groupId: string
  courseId: string
  courseTitle: string
  subject: string | null
}

export interface StudentHwItem {
  attemptId: string
  hwTitle: string
  status: 'draft' | 'submitted' | 'accepted' | 'returned_for_revision'
  score: number | null
  gradeScale: 'five' | 'hundred' | null
  updatedAt: string | null
}

export interface StudentTestItem {
  attemptId: string
  testTitle: string
  totalPoints: number | null
  maxPoints: number | null
  completedAt: string | null
}

export interface StudentStats {
  courses: number
  hwTotal: number
  hwAccepted: number
  hwWaiting: number
  hwRevision: number
  testsAvailable: number
  testsCompleted: number
}

interface StudentDashboardData {
  courses: StudentCourseCard[]
  hwItems: StudentHwItem[]
  testItems: StudentTestItem[]
  stats: StudentStats
  loading: boolean
}

export function useStudentDashboard(profileId: string | undefined): StudentDashboardData {
  const [data, setData] = useState<StudentDashboardData>({
    courses: [],
    hwItems: [],
    testItems: [],
    stats: {
      courses: 0,
      hwTotal: 0,
      hwAccepted: 0,
      hwWaiting: 0,
      hwRevision: 0,
      testsAvailable: 0,
      testsCompleted: 0,
    },
    loading: true,
  })

  useEffect(() => {
    if (!profileId) return

    let cancelled = false

    async function load() {
      try {
        // Get student ID from profile
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('profile_id', profileId!)
          .single()

        if (!student || cancelled) {
          setData(d => ({ ...d, loading: false }))
          return
        }

        // 1. Get courses (group_students → groups → courses)
        const { data: groupStudentsData } = await supabase
          .from('group_students')
          .select('group_id, groups!inner(id, course_id, courses!inner(id, title, subject))')
          .eq('student_id', student.id) as any

        const seenCourses = new Map<string, StudentCourseCard>()
        if (groupStudentsData) {
          for (const gs of groupStudentsData) {
            const group = gs.groups
            const course = group.courses
            if (!seenCourses.has(course.id)) {
              seenCourses.set(course.id, {
                groupId: group.id,
                courseId: course.id,
                courseTitle: course.title,
                subject: course.subject || null,
              })
            }
          }
        }
        const courses = Array.from(seenCourses.values())

        // 2. Get total available homework (count)
        const { count: hwTotalCount } = await supabase
          .from('topic_homework')
          .select('id', { count: 'exact', head: true })

        // 3. Get my homework attempts
        const { data: hwAttemptsData } = await supabase
          .from('topic_homework_attempts')
          .select(
            'id, status, updated_at, topic_homework(title, grade_scale), topic_homework_reviews(decision, score, created_at)'
          )
          .eq('student_id', student.id)
          .order('updated_at', { ascending: false }) as any

        let hwAcceptedCount = 0
        let hwWaitingCount = 0
        let hwRevisionCount = 0
        const hwItems: StudentHwItem[] = []

        if (hwAttemptsData) {
          for (const attempt of hwAttemptsData) {
            const hw = attempt.topic_homework
            const reviews = attempt.topic_homework_reviews || []

            let score: number | null = null
            if (attempt.status === 'accepted' && reviews.length > 0) {
              const acceptedReview = reviews.find((r: any) => r.decision === 'accepted')
              if (acceptedReview) {
                score = acceptedReview.score
              }
            }

            const hwItem: StudentHwItem = {
              attemptId: attempt.id,
              hwTitle: hw.title,
              status: attempt.status,
              score,
              gradeScale: hw.grade_scale,
              updatedAt: attempt.updated_at,
            }

            if (attempt.status === 'accepted') {
              hwAcceptedCount++
            } else if (attempt.status === 'submitted') {
              hwWaitingCount++
            } else if (attempt.status === 'returned_for_revision') {
              hwRevisionCount++
            }

            hwItems.push(hwItem)
          }
        }

        // 4. Get available test assignments (count)
        const { count: testsAvailableCount } = await supabase
          .from('topic_test_assignments')
          .select('id', { count: 'exact', head: true })

        // 5. Get my test attempts (only completed)
        const { data: testAttemptsData } = await supabase
          .from('topic_test_attempts')
          .select('id, status, total_points, max_points, completed_at, topic_tests(title)')
          .eq('student_id', student.id)
          .order('completed_at', { ascending: false }) as any

        const testItems: StudentTestItem[] = []
        let testsCompletedCount = 0

        if (testAttemptsData) {
          for (const attempt of testAttemptsData) {
            if (attempt.status === 'completed' && attempt.completed_at) {
              const testItem: StudentTestItem = {
                attemptId: attempt.id,
                testTitle: attempt.topic_tests?.title || 'Тест',
                totalPoints: attempt.total_points,
                maxPoints: attempt.max_points,
                completedAt: attempt.completed_at,
              }
              testItems.push(testItem)
              testsCompletedCount++
            }
          }
        }

        if (!cancelled) {
          setData({
            courses,
            hwItems: hwItems.slice(0, 5),
            testItems: testItems.slice(0, 5),
            stats: {
              courses: courses.length,
              hwTotal: hwTotalCount || 0,
              hwAccepted: hwAcceptedCount,
              hwWaiting: hwWaitingCount,
              hwRevision: hwRevisionCount,
              testsAvailable: testsAvailableCount || 0,
              testsCompleted: testsCompletedCount,
            },
            loading: false,
          })
        }
      } catch (error) {
        console.error('Error loading student dashboard:', error)
        if (!cancelled) {
          setData(d => ({ ...d, loading: false }))
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [profileId])

  return data
}
