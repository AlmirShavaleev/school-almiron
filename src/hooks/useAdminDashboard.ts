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

export interface AdminSubscription {
  id:           string
  student_name: string
  student_id:   string
  plan_name:    string
  status:       string
  period_end:   string | null
  amount:       number
  currency:     string
  billing_period: string
  auto_renew:   boolean
  created_at:   string
}

export interface AdminStats {
  total_users:        number
  total_students:     number
  total_teachers:     number
  active_groups:      number
  active_subs:        number
  monthly_revenue:    number
  pending_subs:       number
  new_users_week:     number
  pending_hw_count:   number
}

export function useAdminDashboard() {
  const [profiles,      setProfiles]      = useState<AdminProfile[]>([])
  const [groups,        setGroups]        = useState<AdminGroup[]>([])
  const [courses,       setCourses]       = useState<AdminCourse[]>([])
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([])
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
    const [profilesRes, groupsRes, coursesRes, subsRes, studentsRes, pendingHwRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, created_at, avatar_url').order('created_at', { ascending: false }),
      supabase.from('groups')
        .select('id, name, is_active, max_students, schedule_days, schedule_time, group_students(count), teachers(profiles(full_name)), courses(title, subject)')
        .order('name'),
      supabase.from('courses').select('id, title, subject, exam_type, duration_weeks, price, description, start_date, end_date, enrollment_open_until, is_active').order('title'),
      supabase.from('subscriptions')
        .select('id, student_id, status, current_period_end, cancel_at_period_end, created_at, plans(name, price, currency, billing_period), students(profile_id, profiles(full_name))')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('students').select('id, profile_id'),
      supabase.from('homework_submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
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

    // Subscriptions
    const builtSubs: AdminSubscription[] = (subsRes.data || []).map((s: any) => ({
      id:             s.id,
      student_name:   s.students?.profiles?.full_name || '—',
      student_id:     s.student_id,
      plan_name:      s.plans?.name || '—',
      status:         s.status,
      period_end:     s.current_period_end,
      amount:         s.plans?.price || 0,
      currency:       s.plans?.currency || 'RUB',
      billing_period: s.plans?.billing_period || 'month',
      auto_renew:     !s.cancel_at_period_end,
      created_at:     s.created_at,
    }))

    // Stats
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const activeSubs  = builtSubs.filter(s => s.status === 'active' || s.status === 'trial')
    const monthRev    = activeSubs
      .filter(s => s.billing_period === 'month')
      .reduce((sum, s) => sum + s.amount, 0)

    const builtStats: AdminStats = {
      total_users:      builtProfiles.length,
      total_students:   builtProfiles.filter(p => p.role === 'student').length,
      total_teachers:   builtProfiles.filter(p => p.role === 'teacher').length,
      active_groups:    builtGroups.filter(g => g.is_active).length,
      active_subs:      activeSubs.length,
      monthly_revenue:  monthRev,
      pending_subs:     builtSubs.filter(s => s.status === 'past_due').length,
      new_users_week:   builtProfiles.filter(p => p.created_at > oneWeekAgo).length,
      pending_hw_count: pendingHwRes.count ?? 0,
    }

    setProfiles(builtProfiles)
    setGroups(builtGroups)
    setCourses(builtCourses)
    setSubscriptions(builtSubs)
    setStats(builtStats)
  }

  return { profiles, groups, courses, subscriptions, stats, loading, reload }
}
