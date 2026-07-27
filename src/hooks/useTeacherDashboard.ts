import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface TeacherCourseCard {
  id: string
  title: string
  subject: string | null
  exam_type: string | null
  is_active: boolean
  studentCount: number
}

export interface PendingReviewItem {
  attemptId: string
  studentName: string
  hwTitle: string
  submittedAt: string | null
}

export interface RecentTestResult {
  attemptId: string
  studentName: string
  testTitle: string
  totalPoints: number | null
  maxPoints: number | null
  completedAt: string | null
}

export interface TeacherStats {
  courses: number
  students: number
  pendingReviews: number
  bankTests: number
}

export function useTeacherDashboard(profileId: string | undefined, role: string | undefined) {
  const [courses,         setCourses]         = useState<TeacherCourseCard[]>([])
  const [pendingReviews,  setPendingReviews]  = useState<PendingReviewItem[]>([])
  const [recentTests,     setRecentTests]     = useState<RecentTestResult[]>([])
  const [stats,           setStats]           = useState<TeacherStats | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [tick,            setTick]            = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    setLoading(true)
    load(profileId, role)
      .then(() => { if (!cancelled) setLoading(false) })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, role, tick])

  async function load(pid: string, r: string | undefined) {
    try {
      // ── 1. Fetch courses ───────────────────────────────────────────────────
      let coursesQuery = supabase
        .from('courses')
        .select('id, title, subject, exam_type, is_active')
        .order('created_at', { ascending: false })

      if (r === 'teacher') {
        coursesQuery = coursesQuery.eq('owner_id', pid)
      }

      const { data: coursesData } = await coursesQuery
      const rawCourses = coursesData || []
      const courseIds = rawCourses.map(c => c.id)

      // ── 2. Fetch student counts per course ──────────────────────────────────
      let courseStudentMap: Record<string, number> = {}
      let totalUniqueStudents = new Set<string>()

      if (courseIds.length > 0) {
        const { data: groupStudents } = await supabase
          .from('group_students')
          .select('student_id, groups!inner(course_id)')
          .in('groups.course_id', courseIds)

        const rawGroupStudents = groupStudents || []
        for (const gs of rawGroupStudents) {
          const courseId = (gs.groups as any)?.course_id
          if (courseId) {
            if (!courseStudentMap[courseId]) courseStudentMap[courseId] = 0
            courseStudentMap[courseId]++
            totalUniqueStudents.add(gs.student_id)
          }
        }
      }

      // ── 3. Build courses with student counts ────────────────────────────────
      const builtCourses: TeacherCourseCard[] = rawCourses.map(c => ({
        id: c.id,
        title: c.title,
        subject: c.subject || null,
        exam_type: c.exam_type || null,
        is_active: c.is_active !== false,
        studentCount: courseStudentMap[c.id] || 0,
      }))

      // ── 4. Fetch pending reviews ───────────────────────────────────────────
      const { data: rawPendingReviews } = await supabase
        .from('topic_homework_attempts')
        .select('id, submitted_at, students(profiles(full_name)), topic_homework(title)')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true })
        .limit(5)

      const builtPendingReviews: PendingReviewItem[] = (rawPendingReviews || []).map((r: any) => ({
        attemptId: r.id,
        studentName: r.students?.profiles?.full_name ?? 'Ученик',
        hwTitle: r.topic_homework?.title ?? '—',
        submittedAt: r.submitted_at,
      }))

      // ── 5. Fetch recent test results ───────────────────────────────────────
      const { data: rawRecentTests } = await supabase
        .from('topic_test_attempts')
        .select('id, total_points, max_points, completed_at, students(profiles(full_name)), topic_tests(title)')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5)

      const builtRecentTests: RecentTestResult[] = (rawRecentTests || []).map((r: any) => ({
        attemptId: r.id,
        studentName: r.students?.profiles?.full_name ?? 'Ученик',
        testTitle: r.topic_tests?.title ?? '—',
        totalPoints: r.total_points,
        maxPoints: r.max_points,
        completedAt: r.completed_at,
      }))

      // ── 6. Count pending reviews (exact count) ──────────────────────────────
      const { count: pendingReviewsCount } = await supabase
        .from('topic_homework_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted')

      // ── 7. Count bank tests ────────────────────────────────────────────────
      const { count: bankTestsCount } = await supabase
        .from('topic_tests')
        .select('id', { count: 'exact', head: true })

      // ── 8. Build stats ────────────────────────────────────────────────────
      const builtStats: TeacherStats = {
        courses: builtCourses.length,
        students: totalUniqueStudents.size,
        pendingReviews: pendingReviewsCount || 0,
        bankTests: bankTestsCount || 0,
      }

      setCourses(builtCourses)
      setPendingReviews(builtPendingReviews)
      setRecentTests(builtRecentTests)
      setStats(builtStats)
    } catch (err) {
      console.error('useTeacherDashboard load error:', err)
    }
  }

  return {
    courses,
    pendingReviews,
    recentTests,
    stats,
    loading,
    reload,
  }
}
