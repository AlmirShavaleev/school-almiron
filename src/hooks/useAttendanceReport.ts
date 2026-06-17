import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface AttendanceRow {
  student_id:   string
  full_name:    string
  avatar_url:   string | null
  present:      number
  absent:       number
  late:         number
  total:        number
  percent:      number
}

export interface GroupReport {
  group_id:   string
  group_name: string
  rows:       AttendanceRow[]
}

export function useAttendanceReport() {
  const profile = useAuthStore(s => s.profile)
  const [groups,  setGroups]  = useState<GroupReport[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    load()
  }, [profile, tick])

  async function load() {
    setLoading(true)
    try {
      // 1. Get groups scoped to role
      let groupsQuery = supabase.from('groups').select('id, name')

      if (profile!.role === 'teacher') {
        const { data: teacher } = await supabase
          .from('teachers').select('id').eq('profile_id', profile!.id).single()
        if (!teacher) { setGroups([]); return }
        groupsQuery = groupsQuery.eq('teacher_id', teacher.id)
      } else if (profile!.role === 'student') {
        const { data: student } = await supabase
          .from('students').select('id').eq('profile_id', profile!.id).single()
        if (!student) { setGroups([]); return }
        const { data: gs } = await supabase
          .from('group_students').select('group_id').eq('student_id', student.id)
        const ids = (gs || []).map((g: any) => g.group_id)
        if (!ids.length) { setGroups([]); return }
        groupsQuery = groupsQuery.in('id', ids)
      }

      const { data: groupList } = await groupsQuery.order('name')
      if (!groupList?.length) { setGroups([]); setLoading(false); return }

      // 2. For each group: students + attendance
      const result: GroupReport[] = []

      for (const g of groupList) {
        // Students in group
        const { data: gs } = await supabase
          .from('group_students')
          .select('student_id, students(id, profiles(full_name, avatar_url))')
          .eq('group_id', g.id)

        // Attendance records for lessons in this group
        const { data: att } = await supabase
          .from('attendance')
          .select('student_id, status, lesson_id')
          .in('lesson_id',
            (await supabase.from('lessons').select('id').eq('group_id', g.id)).data?.map((l: any) => l.id) || []
          )

        // Tally per student
        const tally: Record<string, { present: number; absent: number; late: number }> = {}
        for (const a of att || []) {
          if (!tally[a.student_id]) tally[a.student_id] = { present: 0, absent: 0, late: 0 }
          tally[a.student_id][a.status as 'present' | 'absent' | 'late']++
        }

        const rows: AttendanceRow[] = (gs || []).map((item: any) => {
          const sid = item.student_id
          const t = tally[sid] || { present: 0, absent: 0, late: 0 }
          const total = t.present + t.absent + t.late
          return {
            student_id: sid,
            full_name:  item.students?.profiles?.full_name || '—',
            avatar_url: item.students?.profiles?.avatar_url || null,
            present:    t.present,
            absent:     t.absent,
            late:       t.late,
            total,
            percent:    total > 0 ? Math.round((t.present + t.late) / total * 100) : 0,
          }
        })

        rows.sort((a, b) => b.percent - a.percent)
        result.push({ group_id: g.id, group_name: g.name, rows })
      }

      setGroups(result)
    } finally {
      setLoading(false)
    }
  }

  return { groups, loading, reload }
}
