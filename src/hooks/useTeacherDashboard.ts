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

export interface TeacherHW {
  id:             string
  title:          string
  due_date:       string
  group_name:     string   // тема курса (ДЗ — на уровне темы)
  max_score:      number
  total_students: number   // учеников, имеющих сдачу
  submitted_count: number  // submitted + checked (any response)
  pending_count:  number   // submitted only — awaiting review
  checked_count:  number   // already graded
}

export interface PendingSubmission {
  id:             string
  homework_id:    string
  homework_title: string
  student_name:   string
  student_id:     string
  profile_id:     string
  submitted_at:   string | null
  file_url:       string | null
}


export interface TeacherStats {
  total_groups:   number
  total_students: number
  pending_reviews: number
  today_lessons:  number
  overdue_hw:     number
}

export function useTeacherDashboard(profileId: string | undefined) {
  const [groups,       setGroups]       = useState<TeacherGroup[]>([])
  const [lessons,      setLessons]      = useState<TeacherLesson[]>([])
  const [homeworks,    setHomeworks]    = useState<TeacherHW[]>([])
  const [pendingSubs,  setPendingSubs]  = useState<PendingSubmission[]>([])
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

    // ── Round 2: groups + lessons + homeworks (parallel) ─────────────────────
    const [groupsRes, lessonsRes, hwRes] = await Promise.all([
      supabase.from('groups')
        .select('id, name, is_active, schedule_days, schedule_time, group_students(count), courses(title, subject)')
        .eq('teacher_id', tid)
        .order('name'),

      supabase.from('lessons')
        .select('id, title, scheduled_at, duration_minutes, zoom_link, group_id, groups(name)')
        .eq('teacher_id', tid)
        .gte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .limit(20),

      supabase.from('homeworks')
        .select('id, title, due_date, max_score, topics(title)')
        .eq('created_by', tid)
        .order('due_date', { ascending: false })
        .limit(30),
    ])

    const rawGroups  = groupsRes.data  || []
    const rawLessons = lessonsRes.data || []
    const rawHW      = hwRes.data      || []

    const hwIds      = rawHW.map((h: any) => h.id)

    // Build group student-count map
    const groupStudentCount: Record<string, number> = {}
    for (const g of rawGroups) {
      groupStudentCount[(g as any).id] = (g as any).group_students?.[0]?.count || 0
    }

    // ── Round 3: all submissions for teacher's homeworks ─────────────────────
    const [subsRes] = await Promise.all([
      hwIds.length
        ? supabase.from('homework_submissions')
            .select('id, homework_id, student_id, status, submitted_at, file_url, students(id, profile_id, profiles(full_name))')
            .in('homework_id', hwIds)
        : Promise.resolve({ data: [] }),
    ])

    const allSubs = subsRes.data || []

    // Index submissions by homework_id
    type SubRecord = { id: string; homework_id: string; student_id: string; status: string; submitted_at: string | null; file_url: string | null; students: any }
    const subsByHW: Record<string, SubRecord[]> = {}
    for (const s of allSubs as SubRecord[]) {
      if (!subsByHW[s.homework_id]) subsByHW[s.homework_id] = []
      subsByHW[s.homework_id].push(s)
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

    const builtHW: TeacherHW[] = rawHW.map((hw: any) => {
      const subs     = subsByHW[hw.id] || []
      const pending  = subs.filter(s => s.status === 'submitted').length
      const checked  = subs.filter(s => s.status === 'checked').length
      const submitted = subs.filter(s => ['submitted', 'checked'].includes(s.status)).length
      return {
        id:             hw.id,
        title:          hw.title,
        due_date:       hw.due_date,
        group_name:     (hw as any).topics?.title || '—',
        max_score:      hw.max_score || 100,
        total_students: new Set(subs.map(s => s.student_id)).size,
        submitted_count: submitted,
        pending_count:  pending,
        checked_count:  checked,
      }
    })

    // Pending submissions list (up to 20 most recent)
    const builtPending: PendingSubmission[] = (allSubs as SubRecord[])
      .filter(s => s.status === 'submitted')
      .sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))
      .slice(0, 20)
      .map(s => {
        const hw = rawHW.find((h: any) => h.id === s.homework_id)
        return {
          id:             s.id,
          homework_id:    s.homework_id,
          homework_title: hw?.title || '—',
          student_name:   (s.students as any)?.profiles?.full_name || '—',
          student_id:     (s.students as any)?.id || '',
          profile_id:     (s.students as any)?.profile_id || '',
          submitted_at:   s.submitted_at,
          file_url:       s.file_url,
        }
      })

    // Stats
    const todayLessons = builtLessons.filter(l => {
      const d = new Date(l.scheduled_at)
      return d >= todayStart && d <= todayEnd
    })

    const builtStats: TeacherStats = {
      total_groups:    builtGroups.length,
      total_students:  builtGroups.reduce((s, g) => s + g.student_count, 0),
      pending_reviews: builtPending.length,
      today_lessons:   todayLessons.length,
      overdue_hw:      builtHW.filter(h => new Date(h.due_date) < new Date() && h.pending_count > 0).length,
    }

    setGroups(builtGroups)
    setLessons(builtLessons)
    setHomeworks(builtHW)
    setPendingSubs(builtPending)
    setStats(builtStats)
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function gradeSubmission(submissionId: string, score: number, feedback: string): Promise<void> {
    await supabase.from('homework_submissions').update({
      status:   'checked',
      score,
      feedback,
      checked_at: new Date().toISOString(),
    }).eq('id', submissionId)
    reload()
  }

  // Computed helpers
  const todayLessons = lessons.filter(l => {
    const d = new Date(l.scheduled_at)
    const s = new Date(); s.setHours(0, 0, 0, 0)
    const e = new Date(); e.setHours(23, 59, 59, 999)
    return d >= s && d <= e
  })

  return {
    groups, lessons, homeworks, pendingSubs, stats,
    todayLessons,
    loading, reload,
    gradeSubmission,
  }
}
