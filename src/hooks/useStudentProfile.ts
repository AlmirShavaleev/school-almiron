import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface StudentProfileData {
  // Identity
  student_id:  string
  profile_id:  string
  full_name:   string
  avatar_url:  string | null
  email:       string
  phone:       string | null
  // Academic
  target_score: number | null
  groups:      { id: string; name: string; course_title: string }[]
  // Stats
  attendance_percent: number
  attendance_present: number
  attendance_absent:  number
  attendance_late:    number
  hw_total:           number
  hw_checked:         number
  hw_avg_score:       number | null  // percent 0-100
  hw_completion_pct:  number         // percent 0-100
  course_progress_pct: number        // percent 0-100
  mock_count:   number
  mock_avg:     number | null        // percent 0-100
  // Lists
  homeworks: {
    id: string; title: string; due_date: string
    status: string; score: number | null; max_score: number; feedback: string | null
    group_name: string
  }[]
  mock_results: {
    id: string; title: string; date: string
    score: number; max_score: number; subject: string
  }[]
  recent_attendance: {
    lesson_title: string; scheduled_at: string; status: string; note: string | null
  }[]
}

export function useStudentProfile(studentId: string | null) {
  const [data,    setData]    = useState<StudentProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) return
    setLoading(true)
    load(studentId)
  }, [studentId, tick])

  async function load(sid: string) {
    try {
      // 1. Student + profile
      const { data: st } = await supabase
        .from('students')
        .select('*, profiles(id, full_name, avatar_url, email, phone)')
        .eq('id', sid)
        .single()
      if (!st) return

      const profile = (st as any).profiles

      // 2. Groups
      const { data: gs } = await supabase
        .from('group_students')
        .select('group_id, groups(id, name, course_id, courses(title))')
        .eq('student_id', sid)

      const groups = (gs || []).map((g: any) => ({
        id:           g.group_id,
        name:         g.groups?.name || '—',
        course_title: g.groups?.courses?.title || '—',
        course_id:    g.groups?.course_id || null,
      }))
      const groupIds  = groups.map(g => g.id)
      const courseIds = [...new Set(groups.map((g: any) => g.course_id).filter(Boolean))]

      // 3. Attendance
      const lessonIds = groupIds.length
        ? (await supabase.from('lessons').select('id').in('group_id', groupIds)).data?.map((l: any) => l.id) || []
        : []

      const { data: att } = lessonIds.length
        ? await supabase.from('attendance').select('status, note, lesson_id').eq('student_id', sid).in('lesson_id', lessonIds)
        : { data: [] }

      const attPresent = (att || []).filter((a: any) => a.status === 'present').length
      const attAbsent  = (att || []).filter((a: any) => a.status === 'absent').length
      const attLate    = (att || []).filter((a: any) => a.status === 'late').length
      const attTotal   = (att || []).length
      const attPercent = attTotal > 0 ? Math.round((attPresent + attLate) / attTotal * 100) : 0

      // Recent attendance with lesson info
      const recentAttLessonIds = (att || []).slice(-10).map((a: any) => a.lesson_id)
      let recentAttendance: any[] = []
      if (recentAttLessonIds.length) {
        const { data: recentLessons } = await supabase
          .from('lessons')
          .select('id, title, scheduled_at')
          .in('id', recentAttLessonIds)
          .order('scheduled_at', { ascending: false })
          .limit(10)

        const attMap: Record<string, any> = {}
        for (const a of att || []) attMap[a.lesson_id] = a

        recentAttendance = (recentLessons || []).map((l: any) => ({
          lesson_title: l.title,
          scheduled_at: l.scheduled_at,
          status:       attMap[l.id]?.status || 'present',
          note:         attMap[l.id]?.note || null,
        }))
      }

      // 4. Homeworks
      const { data: hws } = groupIds.length
        ? await supabase
            .from('homeworks')
            .select('id, title, due_date, max_score, group_id, groups(name)')
            .in('group_id', groupIds)
            .order('due_date', { ascending: false })
        : { data: [] }

      const hwIds = (hws || []).map((h: any) => h.id)
      const { data: subs } = hwIds.length
        ? await supabase
            .from('homework_submissions')
            .select('homework_id, status, score, feedback')
            .eq('student_id', sid)
            .in('homework_id', hwIds)
        : { data: [] }

      const subMap: Record<string, any> = {}
      for (const s of subs || []) subMap[s.homework_id] = s

      const homeworks = (hws || []).map((h: any) => {
        const sub = subMap[h.id]
        return {
          id:         h.id,
          title:      h.title,
          due_date:   h.due_date,
          status:     sub?.status || 'not_submitted',
          score:      sub?.score ?? null,
          max_score:  h.max_score,
          feedback:   sub?.feedback || null,
          group_name: h.groups?.name || '—',
        }
      })

      const hwChecked     = homeworks.filter(h => h.status === 'checked')
      const hwSubmitted   = homeworks.filter(h => h.status !== 'not_submitted').length
      const hwAvg         = hwChecked.length > 0
        ? Math.round(hwChecked.reduce((s, h) => s + (h.score! / h.max_score * 100), 0) / hwChecked.length)
        : null
      const hwCompletionPct = homeworks.length > 0
        ? Math.round(hwSubmitted / homeworks.length * 100)
        : 0

      // 5. Course progress — unique topics covered by completed lessons / total topics in courses
      let courseProgressPct = 0
      if (groupIds.length && courseIds.length) {
        const [completedLessonsRes, totalTopicsRes] = await Promise.all([
          supabase
            .from('lessons')
            .select('topic_id')
            .in('group_id', groupIds)
            .eq('status', 'completed')
            .not('topic_id', 'is', null),
          supabase
            .from('topics')
            .select('id', { count: 'exact', head: true })
            .in('module_id',
              (await supabase.from('modules').select('id').in('course_id', courseIds as string[])).data?.map((m: any) => m.id) || []
            ),
        ])
        const uniqueDone = new Set((completedLessonsRes.data || []).map((l: any) => l.topic_id)).size
        const totalTopics = totalTopicsRes.count || 0
        courseProgressPct = totalTopics > 0 ? Math.min(Math.round(uniqueDone / totalTopics * 100), 100) : 0
      }

      // 6. Mock results
      const { data: mocks } = await supabase
        .from('mock_exam_results')
        .select('id, score, mock_exams(title, date, max_score, subject)')
        .eq('student_id', sid)
        .order('created_at', { ascending: false })

      const mockResults = (mocks || []).map((m: any) => ({
        id:        m.id,
        title:     m.mock_exams?.title || '—',
        date:      m.mock_exams?.date  || '',
        score:     m.score,
        max_score: m.mock_exams?.max_score || 100,
        subject:   m.mock_exams?.subject  || '',
      }))

      const mockAvg = mockResults.length > 0
        ? Math.round(mockResults.reduce((s, m) => s + m.score / m.max_score * 100, 0) / mockResults.length)
        : null

      setData({
        student_id:  sid,
        profile_id:  profile?.id,
        full_name:   profile?.full_name || '—',
        avatar_url:  profile?.avatar_url || null,
        email:       profile?.email || '',
        phone:       profile?.phone || null,
        target_score: st.target_score || null,
        groups,
        attendance_percent:  attPercent,
        attendance_present:  attPresent,
        attendance_absent:   attAbsent,
        attendance_late:     attLate,
        hw_total:            homeworks.length,
        hw_checked:          hwChecked.length,
        hw_avg_score:        hwAvg,
        hw_completion_pct:   hwCompletionPct,
        course_progress_pct: courseProgressPct,
        mock_count:          mockResults.length,
        mock_avg:            mockAvg,
        homeworks,
        mock_results:        mockResults,
        recent_attendance:   recentAttendance,
      })
    } finally {
      setLoading(false)
    }
  }

  return { data, loading, reload }
}
