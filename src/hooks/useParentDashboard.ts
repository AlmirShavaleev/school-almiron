import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface ParentChild {
  // Student record
  student_id:    string
  profile_id:    string
  full_name:     string
  email:         string
  avatar_url:    string | null
  grade:         number | null
  target_exam:   string | null
  target_subject: string | null
  target_score:  number | null
  xp_points:     number
  league:        string
  // Stats
  attendance_rate:    number
  attendance_present: number
  attendance_absent:  number
  attendance_late:    number
  hw_total:    number
  hw_pending:  number
  hw_checked:  number
  mock_count:  number
  mock_avg:    number | null
  // Data
  upcoming_lesson: {
    id: string; title: string; scheduled_at: string
    duration_minutes: number; zoom_link: string | null
  } | null
  homeworks: {
    id: string; title: string; due_date: string; max_score: number
    status: string; score: number | null; group_name: string
  }[]
  mock_results: {
    id: string; title: string; date: string; score: number; max_score: number
  }[]
  recent_attendance: {
    lesson_title: string; scheduled_at: string; status: string
  }[]
  subscription: {
    plan_name: string; status: string
    period_end: string | null; cancel_at_period_end: boolean
    price: number; currency: string; billing_period: string
  } | null
}

export function useParentDashboard(profileId: string | undefined) {
  const [children,         setChildren]         = useState<ParentChild[]>([])
  const [selectedChildId,  setSelectedChildId]  = useState<string | null>(null)
  const [loading,          setLoading]          = useState(true)
  const [tick,             setTick]             = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    load(profileId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, tick])

  async function load(pid: string) {
    try {
      // 1. Parent record
      const { data: parent } = await supabase
        .from('parents').select('id').eq('profile_id', pid).single()
      if (!parent) { setLoading(false); return }

      // 2. Children list
      const { data: ps } = await supabase
        .from('parent_students')
        .select('students(id, xp_points, league, grade, target_exam, target_subject, target_score, profile_id, profiles(full_name, email, avatar_url))')
        .eq('parent_id', parent.id)

      const rawChildren = (ps || []).map((p: any) => p.students).filter(Boolean)
      if (rawChildren.length === 0) { setLoading(false); return }

      // Load detailed data for each child
      const detailed = await Promise.all(rawChildren.map(loadChildData))
      setChildren(detailed)

      setSelectedChildId(prev => {
        if (prev && detailed.find(c => c.student_id === prev)) return prev
        return detailed[0]?.student_id || null
      })
    } finally {
      setLoading(false)
    }
  }

  async function loadChildData(st: any): Promise<ParentChild> {
    const sid     = st.id
    const profile = st.profiles

    // ── Round 1: parallel independent queries ─────────────────────────────────
    const [
      { data: gs },
      { data: mocks },
      { data: subRow },
    ] = await Promise.all([
      supabase.from('group_students').select('group_id, groups(id, name)').eq('student_id', sid),
      supabase.from('mock_exam_results').select('id, score, mock_exams(title, date, max_score)')
        .eq('student_id', sid).order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*, plans(*)')
        .eq('student_id', sid)
        .in('status', ['active', 'trial', 'past_due'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    const groupIds: string[] = (gs || []).map((g: any) => g.group_id)
    const groupMap: Record<string, string> = {}
    for (const g of gs || []) groupMap[(g as any).group_id] = (g as any).groups?.name || '—'

    // ── Round 2: parallel group-dependent queries ─────────────────────────────
    const now = new Date().toISOString()
    const [
      lessonRows,
      { data: upcomingLesson },
      { data: hws },
    ] = await Promise.all([
      groupIds.length
        ? supabase.from('lessons').select('id').in('group_id', groupIds).then(r => r.data || [])
        : Promise.resolve([]),
      groupIds.length
        ? supabase.from('lessons')
            .select('id, title, scheduled_at, duration_minutes, zoom_link')
            .in('group_id', groupIds).gte('scheduled_at', now)
            .order('scheduled_at').limit(1).maybeSingle()
            .then(r => ({ data: r.data }))
        : Promise.resolve({ data: null }),
      groupIds.length
        ? supabase.from('homeworks')
            .select('id, title, due_date, max_score, group_id')
            .in('group_id', groupIds).order('due_date', { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
    ])

    const lessonIds: string[] = (lessonRows as any[]).map(l => l.id)
    const hwIds: string[] = (hws || []).map((h: any) => h.id)

    // ── Round 3: parallel lesson/hw dependent queries ─────────────────────────
    const [
      { data: att },
      { data: recentLessons },
      { data: subs },
    ] = await Promise.all([
      lessonIds.length
        ? supabase.from('attendance').select('status, lesson_id').eq('student_id', sid).in('lesson_id', lessonIds)
        : Promise.resolve({ data: [] }),
      lessonIds.length
        ? supabase.from('lessons').select('id, title, scheduled_at')
            .in('id', lessonIds).order('scheduled_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] }),
      hwIds.length
        ? supabase.from('homework_submissions').select('homework_id, status, score').eq('student_id', sid).in('homework_id', hwIds)
        : Promise.resolve({ data: [] }),
    ])

    // ── Attendance stats ───────────────────────────────────────────────────────
    const attPresent = (att || []).filter((a: any) => a.status === 'present').length
    const attAbsent  = (att || []).filter((a: any) => a.status === 'absent').length
    const attLate    = (att || []).filter((a: any) => a.status === 'late').length
    const attTotal   = attPresent + attAbsent + attLate
    const attRate    = attTotal > 0 ? Math.round((attPresent + attLate) / attTotal * 100) : 0

    const attMap: Record<string, string> = {}
    for (const a of att || []) attMap[(a as any).lesson_id] = (a as any).status
    const recentAtt: ParentChild['recent_attendance'] = (recentLessons || []).map((l: any) => ({
      lesson_title: l.title, scheduled_at: l.scheduled_at, status: attMap[l.id] || 'absent',
    }))

    // ── Homeworks ─────────────────────────────────────────────────────────────
    const subMap: Record<string, any> = {}
    for (const s of subs || []) subMap[(s as any).homework_id] = s

    const hwData: ParentChild['homeworks'] = (hws || []).map((hw: any) => {
      const sub = subMap[hw.id]
      return {
        id: hw.id, title: hw.title, due_date: hw.due_date, max_score: hw.max_score,
        status:     sub?.status || 'not_submitted',
        score:      sub?.score ?? null,
        group_name: groupMap[hw.group_id] || '—',
      }
    })

    const hwPending = hwData.filter(h => h.status === 'not_submitted' || h.status === 'pending').length
    const hwChecked = hwData.filter(h => h.status === 'checked').length

    // ── Mock results ──────────────────────────────────────────────────────────
    const mockResults: ParentChild['mock_results'] = (mocks || []).map((m: any) => ({
      id: m.id, title: m.mock_exams?.title || '—', date: m.mock_exams?.date || '',
      score: m.score, max_score: m.mock_exams?.max_score || 100,
    }))
    const mockAvg = mockResults.length > 0
      ? Math.round(mockResults.reduce((s, m) => s + m.score / m.max_score * 100, 0) / mockResults.length)
      : null

    // ── Subscription ──────────────────────────────────────────────────────────
    let subscription: ParentChild['subscription'] = null
    if (subRow) {
      subscription = {
        plan_name:            (subRow as any).plans?.name || 'Тариф',
        status:               (subRow as any).status,
        period_end:           (subRow as any).current_period_end,
        cancel_at_period_end: (subRow as any).cancel_at_period_end,
        price:                (subRow as any).plans?.price || 0,
        currency:             (subRow as any).plans?.currency || 'RUB',
        billing_period:       (subRow as any).plans?.billing_period || 'month',
      }
    }

    return {
      student_id:    sid,
      profile_id:    profile?.id,
      full_name:     profile?.full_name || '—',
      email:         profile?.email || '',
      avatar_url:    profile?.avatar_url || null,
      grade:         st.grade,
      target_exam:   st.target_exam,
      target_subject: st.target_subject,
      target_score:  st.target_score,
      xp_points:     st.xp_points || 0,
      league:        st.league || 'bronze',
      attendance_rate:    attRate,
      attendance_present: attPresent,
      attendance_absent:  attAbsent,
      attendance_late:    attLate,
      hw_total:    hwData.length,
      hw_pending:  hwPending,
      hw_checked:  hwChecked,
      mock_count:  mockResults.length,
      mock_avg:    mockAvg,
      upcoming_lesson: upcomingLesson,
      homeworks:   hwData,
      mock_results: mockResults,
      recent_attendance: recentAtt,
      subscription,
    }
  }

  const selectedChild = children.find(c => c.student_id === selectedChildId) || children[0] || null

  return { children, selectedChild, selectedChildId, setSelectedChildId, loading, reload }
}
