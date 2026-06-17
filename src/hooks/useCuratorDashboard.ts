import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface CuratorGroup {
  id:            string
  name:          string
  course_title:  string
  subject:       string | null
  student_count: number
  schedule_days: string[] | null
  schedule_time: string | null
  // Quick stats
  att_rate:      number   // % present+late
  hw_overdue:    number   // count of overdue HWs
}

export interface RiskStudent {
  id:         string
  profile_id: string
  full_name:  string
  xp_points:  number
  league:     string
  grade:      number | null
  group_name: string
  // Risk indicators
  att_rate:       number
  hw_pending:     number
  last_seen_days: number | null   // days since last present
  risk_reasons:   string[]        // ['low_attendance','overdue_hw','low_xp']
}

export interface RecentAbsence {
  student_name: string
  lesson_title: string
  scheduled_at: string
  student_id:   string
  profile_id:   string
}

export interface OverdueHW {
  id:          string
  title:       string
  due_date:    string
  group_id:    string
  group_name:  string
  pending_count: number   // students who haven't submitted
}

export interface PendingSubmission {
  submission_id:  string
  homework_id:    string
  homework_title: string
  student_name:   string
  group_name:     string
  submitted_at:   string
}

export function useCuratorDashboard(profileId: string | undefined) {
  const [groups,             setGroups]             = useState<CuratorGroup[]>([])
  const [atRisk,             setAtRisk]             = useState<RiskStudent[]>([])
  const [recentAbsences,     setRecentAbsences]     = useState<RecentAbsence[]>([])
  const [overdueHW,          setOverdueHW]          = useState<OverdueHW[]>([])
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingSubmission[]>([])
  const [loading,            setLoading]            = useState(true)
  const [tick,               setTick]               = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    load(profileId).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, tick])

  async function load(pid: string) {
    // 1. Curator record
    const { data: curator } = await supabase
      .from('curators').select('id').eq('profile_id', pid).single()
    if (!curator) return

    // 2. Curator's groups with basic data
    const { data: rawGroups } = await supabase
      .from('groups')
      .select('id, name, schedule_days, schedule_time, courses(title, subject)')
      .eq('curator_id', curator.id)
    if (!rawGroups || rawGroups.length === 0) return

    const groupIds = rawGroups.map((g: any) => g.id)

    // 3. Parallel: students, lessons, overdue HW, all HW ids for pending submissions
    const [
      { data: groupStudents },
      { data: allLessons },
      { data: rawOverdueHW },
      { data: allGroupHW },
    ] = await Promise.all([
      supabase.from('group_students')
        .select('group_id, students(id, xp_points, league, grade, profile_id, profiles(full_name, id))')
        .in('group_id', groupIds),
      supabase.from('lessons').select('id, group_id, scheduled_at')
        .in('group_id', groupIds),
      supabase.from('homeworks')
        .select('id, title, due_date, group_id, groups(name)')
        .in('group_id', groupIds)
        .lt('due_date', new Date().toISOString())
        .order('due_date', { ascending: false })
        .limit(20),
      supabase.from('homeworks')
        .select('id, title, group_id, groups(name)')
        .in('group_id', groupIds),
    ])

    const lessonIds = (allLessons || []).map((l: any) => l.id)
    const lessonGroupMap: Record<string, string> = {}
    for (const l of allLessons || []) lessonGroupMap[l.id] = (l as any).group_id

    // 4. Parallel: attendance, HW submissions
    const hwIds      = (rawOverdueHW || []).map((h: any) => h.id)
    const allHwIds   = (allGroupHW   || []).map((h: any) => h.id)

    // Unique students
    const studentMap = new Map<string, any>()
    const studentGroupMap: Record<string, string[]> = {}
    for (const gs of groupStudents || []) {
      const st = (gs as any).students
      if (!st) continue
      if (!studentMap.has(st.id)) studentMap.set(st.id, st)
      studentGroupMap[st.id] = [...(studentGroupMap[st.id] || []), (gs as any).group_id]
    }
    const allStudentIds = Array.from(studentMap.keys())

    const [
      { data: allAttendance },
      { data: allSubmissions },
      { data: recentAbsRaw },
      { data: rawPendingSubs },
    ] = await Promise.all([
      allStudentIds.length && lessonIds.length
        ? supabase.from('attendance').select('student_id, lesson_id, status')
            .in('student_id', allStudentIds).in('lesson_id', lessonIds)
        : Promise.resolve({ data: [] }),
      hwIds.length && allStudentIds.length
        ? supabase.from('homework_submissions').select('homework_id, student_id, status')
            .in('homework_id', hwIds).in('student_id', allStudentIds)
        : Promise.resolve({ data: [] }),
      lessonIds.length
        ? supabase.from('attendance')
            .select('student_id, lesson_id, status, students(id, profile_id, profiles(full_name)), lessons(title, scheduled_at)')
            .in('lesson_id', lessonIds)
            .eq('status', 'absent')
            .order('created_at', { ascending: false })
            .limit(15)
        : Promise.resolve({ data: [] }),
      allHwIds.length
        ? supabase.from('homework_submissions')
            .select('id, homework_id, student_id, submitted_at, students(profiles(full_name))')
            .in('homework_id', allHwIds)
            .eq('status', 'submitted')
            .order('submitted_at', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] }),
    ])

    // ── Per-student attendance map ────────────────────────────────────────────
    type AttMap = Record<string, { present: number; total: number; lastSeen: string | null }>
    const studentAtt: AttMap = {}
    for (const a of allAttendance || []) {
      const sid = (a as any).student_id
      if (!studentAtt[sid]) studentAtt[sid] = { present: 0, total: 0, lastSeen: null }
      studentAtt[sid].total++
      if ((a as any).status === 'present' || (a as any).status === 'late') {
        studentAtt[sid].present++
        const lesson = (allLessons || []).find((l: any) => l.id === (a as any).lesson_id)
        if (lesson) {
          const t = (lesson as any).scheduled_at
          if (!studentAtt[sid].lastSeen || t > studentAtt[sid].lastSeen!) studentAtt[sid].lastSeen = t
        }
      }
    }

    // ── Per-student pending HW map ────────────────────────────────────────────
    const submissionMap: Record<string, Set<string>> = {}
    for (const s of allSubmissions || []) {
      const hid = (s as any).homework_id
      if (!submissionMap[hid]) submissionMap[hid] = new Set()
      if ((s as any).status !== 'not_submitted') submissionMap[hid].add((s as any).student_id)
    }

    // Pending count per student (overdue HW not submitted)
    const studentPendingHW: Record<string, number> = {}
    for (const hw of rawOverdueHW || []) {
      const studentsInGroup = Array.from(studentMap.values())
        .filter((st: any) => studentGroupMap[st.id]?.includes(hw.group_id))
      for (const st of studentsInGroup) {
        if (!submissionMap[hw.id]?.has(st.id)) {
          studentPendingHW[st.id] = (studentPendingHW[st.id] || 0) + 1
        }
      }
    }

    // ── Build at-risk list ────────────────────────────────────────────────────
    const groupNameMap: Record<string, string> = {}
    for (const g of rawGroups) groupNameMap[g.id] = g.name

    const atRiskList: RiskStudent[] = []
    for (const [sid, st] of studentMap) {
      const att    = studentAtt[sid]
      const attRate = att ? Math.round(att.present / att.total * 100) : 100
      const pending = studentPendingHW[sid] || 0
      const lastSeenDays = att?.lastSeen
        ? Math.floor((Date.now() - new Date(att.lastSeen).getTime()) / 86400000)
        : null

      const reasons: string[] = []
      if (attRate < 70)  reasons.push('low_attendance')
      if (pending >= 3)  reasons.push('overdue_hw')
      if (st.xp_points < 1000) reasons.push('low_xp')
      if (lastSeenDays != null && lastSeenDays > 14) reasons.push('inactive')

      if (reasons.length > 0) {
        const gid = studentGroupMap[sid]?.[0]
        atRiskList.push({
          id:          sid,
          profile_id:  st.profile_id,
          full_name:   st.profiles?.full_name || '—',
          xp_points:   st.xp_points || 0,
          league:      st.league || 'bronze',
          grade:       st.grade,
          group_name:  gid ? (groupNameMap[gid] || '—') : '—',
          att_rate:    attRate,
          hw_pending:  pending,
          last_seen_days: lastSeenDays,
          risk_reasons: reasons,
        })
      }
    }
    atRiskList.sort((a, b) => b.risk_reasons.length - a.risk_reasons.length)

    // ── Per-group stats ───────────────────────────────────────────────────────
    const builtGroups: CuratorGroup[] = rawGroups.map((g: any) => {
      const studentsInGroup = Array.from(studentMap.values())
        .filter((st: any) => studentGroupMap[st.id]?.includes(g.id))
      const lessonsInGroup  = (allLessons || []).filter((l: any) => l.group_id === g.id).map((l: any) => l.id)

      let present = 0, total = 0
      for (const st of studentsInGroup) {
        const att = studentAtt[st.id]
        if (att) { present += att.present; total += att.total }
      }
      const attRate = total > 0 ? Math.round(present / total * 100) : 0

      const hwOverdue = (rawOverdueHW || []).filter((h: any) => h.group_id === g.id).length

      return {
        id:            g.id,
        name:          g.name,
        course_title:  g.courses?.title || '—',
        subject:       g.courses?.subject || null,
        student_count: studentsInGroup.length,
        schedule_days: g.schedule_days,
        schedule_time: g.schedule_time,
        att_rate:      attRate,
        hw_overdue:    hwOverdue,
      }
    })

    // ── Recent absences ───────────────────────────────────────────────────────
    const absences: RecentAbsence[] = (recentAbsRaw || []).map((a: any) => ({
      student_name: a.students?.profiles?.full_name || '—',
      lesson_title: a.lessons?.title || '—',
      scheduled_at: a.lessons?.scheduled_at || '',
      student_id:   a.student_id,
      profile_id:   a.students?.profile_id || '',
    }))

    // ── Overdue HW with pending count ─────────────────────────────────────────
    const builtOverdueHW: OverdueHW[] = (rawOverdueHW || []).map((hw: any) => {
      const studentsInGroup = Array.from(studentMap.values())
        .filter((st: any) => studentGroupMap[st.id]?.includes(hw.group_id))
      const pendingCount = studentsInGroup.filter(st => !submissionMap[hw.id]?.has(st.id)).length
      return {
        id:            hw.id,
        title:         hw.title,
        due_date:      hw.due_date,
        group_id:      hw.group_id,
        group_name:    (hw as any).groups?.name || '—',
        pending_count: pendingCount,
      }
    })

    // ── Pending submissions ───────────────────────────────────────────────────
    const hwTitleMap: Record<string, { title: string; group_id: string }> = {}
    for (const hw of allGroupHW || []) hwTitleMap[(hw as any).id] = { title: (hw as any).title, group_name: (hw as any).groups?.name || '—' } as any

    const builtPending: PendingSubmission[] = (rawPendingSubs || []).map((s: any) => {
      const hw = hwTitleMap[s.homework_id]
      return {
        submission_id:  s.id,
        homework_id:    s.homework_id,
        homework_title: hw?.title || '—',
        student_name:   s.students?.profiles?.full_name || '—',
        group_name:     (hw as any)?.group_name || '—',
        submitted_at:   s.submitted_at,
      }
    })

    setGroups(builtGroups)
    setAtRisk(atRiskList)
    setRecentAbsences(absences)
    setOverdueHW(builtOverdueHW)
    setPendingSubmissions(builtPending)
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function sendReminder(profileId: string, studentName: string): Promise<void> {
    await supabase.from('notifications').insert({
      user_id:  profileId,
      type:     'warning',
      title:    '⚠️ Напоминание куратора',
      message:  'Куратор просит уделить больше внимания учёбе: проверь дедлайны и не пропускай занятия.',
      read:     false,
    })
    reload()
  }

  async function notifyGroup(groupId: string): Promise<void> {
    // Get all profile_ids in the group
    const { data: gs } = await supabase
      .from('group_students')
      .select('students(profile_id)')
      .eq('group_id', groupId)

    const profileIds = (gs || []).map((g: any) => g.students?.profile_id).filter(Boolean)
    if (!profileIds.length) return

    await supabase.from('notifications').insert(
      profileIds.map((pid: string) => ({
        user_id: pid,
        type:    'warning',
        title:   '📋 Просроченное задание',
        message: 'В вашей группе есть просроченное домашнее задание. Сдайте как можно скорее!',
        read:    false,
      }))
    )
    reload()
  }

  const totalStudents = groups.reduce((s, g) => s + g.student_count, 0)
  const avgAttRate    = groups.length > 0
    ? Math.round(groups.reduce((s, g) => s + g.att_rate, 0) / groups.length)
    : 0

  return {
    groups, atRisk, recentAbsences, overdueHW, pendingSubmissions,
    totalStudents, avgAttRate,
    loading, reload,
    sendReminder, notifyGroup,
  }
}
