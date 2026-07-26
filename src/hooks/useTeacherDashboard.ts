import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface TeacherGroup {
  id:            string
  name:          string
  is_active:     boolean
  student_count: number
  schedule_days: string[] | null
  schedule_time: string | null
  course_title:  string | null
  subject:       string | null
}

export interface TeacherLesson {
  id:               string
  title:            string
  scheduled_at:     string
  duration_minutes: number | null
  zoom_link:        string | null
  group_id:         string
  group_name:       string
}

export interface TeacherStats {
  total_groups:   number
  total_students: number
  today_lessons:  number
}

export function useTeacherDashboard(profileId: string | undefined) {
  const [groups,       setGroups]       = useState<TeacherGroup[]>([])
  const [lessons,      setLessons]      = useState<TeacherLesson[]>([])
  const [stats,        setStats]        = useState<TeacherStats | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [tick,         setTick]         = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    setLoading(true)
    load(profileId)
      .then(() => { if (!cancelled) setLoading(false) })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, tick])

  async function load(pid: string) {
    // ── Round 1: teacher record ───────────────────────────────────────────────
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('profile_id', pid)
      .single()

    if (!teacher) return

    const tid = teacher.id
    const now  = new Date().toISOString()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)

    // ── Round 2: groups + lessons (parallel) ──────────────────────────────────
    const [groupsRes, lessonsRes] = await Promise.all([
      supabase.from('groups')
        .select('id, name, is_active, schedule_days, schedule_time, group_students(count), courses(title, subject)')
        .eq('teacher_id', tid)
        .eq('is_active', true)
        .order('name'),

      supabase.from('lessons')
        .select('id, title, scheduled_at, duration_minutes, zoom_link, group_id, groups(name)')
        .eq('teacher_id', tid)
        .gte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(20),
    ])

    const rawGroups  = groupsRes.data  || []
    const rawLessons = lessonsRes.data || []

    // Build group student-count map
    const groupStudentCount: Record<string, number> = {}
    for (const g of rawGroups) {
      groupStudentCount[(g as any).id] = (g as any).group_students?.[0]?.count || 0
    }

    // ── Build typed structures ────────────────────────────────────────────────

    const builtGroups: TeacherGroup[] = rawGroups.map((g: any) => ({
      id:            g.id,
      name:          g.name,
      is_active:     g.is_active !== false,
      student_count: groupStudentCount[g.id] || 0,
      schedule_days: g.schedule_days,
      schedule_time: g.schedule_time,
      course_title:  g.courses?.title || null,
      subject:       g.courses?.subject || null,
    }))

    const builtLessons: TeacherLesson[] = rawLessons.map((l: any) => ({
      id:               l.id,
      title:            l.title,
      scheduled_at:     l.scheduled_at,
      duration_minutes: l.duration_minutes,
      zoom_link:        l.zoom_link,
      group_id:         l.group_id,
      group_name:       l.groups?.name || '—',
    }))

    // Stats
    const todayLessons = builtLessons.filter(l => {
      const d = new Date(l.scheduled_at)
      return d >= todayStart && d <= todayEnd
    })

    const builtStats: TeacherStats = {
      total_groups:    builtGroups.length,
      total_students:  builtGroups.reduce((s, g) => s + g.student_count, 0),
      today_lessons:   todayLessons.length,
    }

    setGroups(builtGroups)
    setLessons(builtLessons)
    setStats(builtStats)
  }

  // Computed helpers
  const todayLessons = lessons.filter(l => {
    const d = new Date(l.scheduled_at)
    const s = new Date(); s.setHours(0, 0, 0, 0)
    const e = new Date(); e.setHours(23, 59, 59, 999)
    return d >= s && d <= e
  })

  return {
    groups, lessons, stats,
    todayLessons,
    loading, reload,
  }
}
