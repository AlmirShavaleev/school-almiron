import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface AttendanceRecord {
  id?: string
  lesson_id: string
  student_id: string
  status: AttendanceStatus
  note: string | null
}

export interface StudentWithAttendance {
  student_id: string
  full_name: string
  avatar_url: string | null
  status: AttendanceStatus
  note: string
}

export function useAttendance(lessonId: string | null, groupId: string | null) {
  const [students, setStudents] = useState<StudentWithAttendance[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!lessonId || !groupId) return
    setLoading(true)

    async function load() {
      // All students in group
      const { data: gs } = await supabase
        .from('group_students')
        .select('student_id, students(id, profiles(full_name, avatar_url))')
        .eq('group_id', groupId!)

      // Existing attendance records for this lesson
      const { data: att } = await supabase
        .from('attendance')
        .select('*')
        .eq('lesson_id', lessonId!)

      const attMap: Record<string, AttendanceRecord> = {}
      for (const a of att || []) attMap[a.student_id] = a

      const list: StudentWithAttendance[] = (gs || []).map((g: any) => ({
        student_id: g.student_id,
        full_name:  g.students?.profiles?.full_name || 'Без имени',
        avatar_url: g.students?.profiles?.avatar_url || null,
        status:     attMap[g.student_id]?.status || 'present',
        note:       attMap[g.student_id]?.note   || '',
      }))

      setStudents(list)
      setLoading(false)
    }

    load()
  }, [lessonId, groupId, tick])

  async function saveAll(records: StudentWithAttendance[]) {
    if (!lessonId) return

    const rows = records.map(r => ({
      lesson_id:  lessonId,
      student_id: r.student_id,
      status:     r.status,
      note:       r.note.trim() || null,
    }))

    const { error } = await supabase
      .from('attendance')
      .upsert(rows, { onConflict: 'lesson_id,student_id' })

    if (error) throw new Error(error.message)
    reload()
  }

  return { students, loading, saveAll, reload }
}
