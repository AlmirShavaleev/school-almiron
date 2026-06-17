import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface StudentDashboardData {
  student: any
  nextLesson: any
  homeworks: any[]
  mockResults: any[]
  recommendations: any[]
  attendanceRate: number
  loading: boolean
}

export function useStudentDashboard(profileId: string | undefined): StudentDashboardData {
  const [data, setData] = useState<StudentDashboardData>({
    student: null,
    nextLesson: null,
    homeworks: [],
    mockResults: [],
    recommendations: [],
    attendanceRate: 0,
    loading: true,
  })

  useEffect(() => {
    if (!profileId) return

    async function load() {
      const { data: student } = await supabase
        .from('students')
        .select('*')
        .eq('profile_id', profileId!)
        .single()

      if (!student) {
        setData(d => ({ ...d, loading: false }))
        return
      }

      const { data: groupStudents } = await supabase
        .from('group_students')
        .select('group_id')
        .eq('student_id', student.id)

      const groupIds = (groupStudents || []).map((gs: any) => gs.group_id)

      let nextLesson = null
      if (groupIds.length > 0) {
        const { data: lessons } = await supabase
          .from('lessons')
          .select('*')
          .in('group_id', groupIds)
          .eq('status', 'scheduled')
          .gte('scheduled_at', new Date().toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1)
        nextLesson = lessons?.[0] || null
      }

      let homeworks: any[] = []
      if (groupIds.length > 0) {
        const { data: hws } = await supabase
          .from('homeworks')
          .select('*, homework_submissions(status, score, feedback, submitted_at)')
          .in('group_id', groupIds)
          .order('due_date', { ascending: true })
        homeworks = hws || []
      }

      const { data: mockResults } = await supabase
        .from('mock_exam_results')
        .select('*, mock_exams(title, date, max_score, subject)')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })

      const { data: recs } = await supabase
        .from('recommendations')
        .select('*, profiles!recommendations_created_by_fkey(full_name)')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })

      let attendanceRate = 0
      if (groupIds.length > 0) {
        const { data: attendRecords } = await supabase
          .from('attendance')
          .select('status')
          .eq('student_id', student.id)
        if (attendRecords && attendRecords.length > 0) {
          const present = attendRecords.filter((a: any) => a.status === 'present' || a.status === 'late').length
          attendanceRate = Math.round((present / attendRecords.length) * 100)
        }
      }

      setData({
        student,
        nextLesson,
        homeworks,
        mockResults: mockResults || [],
        recommendations: recs || [],
        attendanceRate,
        loading: false,
      })
    }

    load()
  }, [profileId])

  return data
}
