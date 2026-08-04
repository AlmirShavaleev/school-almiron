import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface AdminProfile {
  id:         string
  full_name:  string
  email:      string
  role:       string
  created_at: string
  avatar_url: string | null
  // role-specific record ids (for navigation)
  student_id: string | null
  teacher_id: string | null
}

export interface AdminGroup {
  id:            string
  name:          string
  is_active:     boolean
  max_students:  number
  student_count: number
  schedule_days: string[] | null
  schedule_time: string | null
  teacher_name:  string | null
  course_title:  string | null
  subject:       string | null
}

export interface AdminCourse {
  id:                    string
  title:                 string
  subject:               string | null
  exam_type:             string | null
  duration_weeks:        number | null
  price:                 number | null
  description:           string | null
  start_date:            string | null
  end_date:              string | null
  enrollment_open_until: string | null
  is_active:             boolean
}

export interface AdminStats {
  total_users:        number
  total_students:     number
  total_teachers:     number
  active_groups:      number
  archived_groups:    number
  new_users_week:     number
}

export function useAdminDashboard() {
  const [profiles,      setProfiles]      = useState<AdminProfile[]>([])
  const [groups,        setGroups]        = useState<AdminGroup[]>([])
  const [courses,       setCourses]       = useState<AdminCourse[]>([])
  const [stats,         setStats]         = useState<AdminStats | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [tick,          setTick]          = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  async function load() {
    // Подписки отсюда убраны вместе с вкладкой (решение владельца 2026-08-04):
    // таблица пуста, а запрос на 100 строк с джойном планов уходил при каждом
    // открытии панели.
    // Счётчик «ДЗ на проверке» отсюда тоже ушёл: он считал легаси-таблицу
    // homework_submissions (0 строк навсегда) и показывал ноль при живой
    // очереди. Теперь это делает admin_school_stats по topic_homework_*.
    const [profilesRes, groupsRes, coursesRes, studentsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, created_at, avatar_url').order('created_at', { ascending: false }),
      supabase.from('groups')
        .select('id, name, is_active, max_students, schedule_days, schedule_time, group_students(count), teachers(profiles(full_name)), courses(title, subject)')
        .order('name'),
      supabase.from('courses').select('id, title, subject, exam_type, duration_weeks, price, description, start_date, end_date, enrollment_open_until, is_active').order('title'),
      supabase.from('students').select('id, profile_id'),
    ])

    // Profiles with student/teacher ids lookup
    const studentByProfile: Record<string, string> = {}
    for (const s of studentsRes.data || []) studentByProfile[(s as any).profile_id] = (s as any).id

    const { data: teachersData } = await supabase.from('teachers').select('id, profile_id')
    const teacherByProfile: Record<string, string> = {}
    for (const t of teachersData || []) teacherByProfile[(t as any).profile_id] = (t as any).id

    const builtProfiles: AdminProfile[] = (profilesRes.data || []).map((p: any) => ({
      id:         p.id,
      full_name:  p.full_name || '—',
      email:      p.email || '',
      role:       p.role,
      created_at: p.created_at,
      avatar_url: p.avatar_url,
      student_id: studentByProfile[p.id] || null,
      teacher_id: teacherByProfile[p.id] || null,
    }))

    // Groups
    const builtGroups: AdminGroup[] = (groupsRes.data || []).map((g: any) => ({
      id:            g.id,
      name:          g.name,
      is_active:     g.is_active !== false,
      max_students:  g.max_students || 15,
      student_count: g.group_students?.[0]?.count || 0,
      schedule_days: g.schedule_days,
      schedule_time: g.schedule_time,
      teacher_name:  g.teachers?.profiles?.full_name || null,
      course_title:  g.courses?.title || null,
      subject:       g.courses?.subject || null,
    }))

    // Courses
    const builtCourses: AdminCourse[] = (coursesRes.data || []).map((c: any) => ({
      id:                    c.id,
      title:                 c.title,
      subject:               c.subject,
      exam_type:             c.exam_type,
      duration_weeks:        c.duration_weeks,
      price:                 c.price,
      description:           c.description,
      start_date:            c.start_date,
      end_date:              c.end_date,
      enrollment_open_until: c.enrollment_open_until,
      is_active:             c.is_active !== false,
    }))

    // Stats
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    const builtStats: AdminStats = {
      total_users:      builtProfiles.length,
      total_students:   builtProfiles.filter(p => p.role === 'student').length,
      total_teachers:   builtProfiles.filter(p => p.role === 'teacher').length,
      active_groups:    builtGroups.filter(g => g.is_active).length,
      archived_groups:  builtGroups.filter(g => !g.is_active).length,
      new_users_week:   builtProfiles.filter(p => p.created_at > oneWeekAgo).length,
    }

    setProfiles(builtProfiles)
    setGroups(builtGroups)
    setCourses(builtCourses)
    setStats(builtStats)
  }

  return { profiles, groups, courses, stats, loading, reload }
}
