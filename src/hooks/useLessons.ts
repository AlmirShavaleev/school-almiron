import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface Lesson {
  id: string
  title: string
  scheduled_at: string
  duration_minutes: number
  status: 'scheduled' | 'completed' | 'cancelled'
  format: 'group' | 'individual'
  zoom_link: string | null
  recording_url: string | null
  group_id: string | null
  student_id: string | null
  teacher_id: string
  groups?: { name: string } | null
  teachers?: { profiles: { full_name: string } } | null
  student_profile?: { full_name: string; avatar_url: string | null } | null
  topics?: { title: string; module_id: string; modules?: { title: string } | null } | null
}

export function useLessons() {
  const profile = useAuthStore(s => s.profile)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return

    async function load() {
      setLoading(true)

      try {
        if (profile!.role === 'student') {
          const { data: student } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()

          if (!student) { setLoading(false); return }

          const { data: gs } = await supabase
            .from('group_students').select('group_id').eq('student_id', student.id)

          const groupIds = (gs || []).map((g: any) => g.group_id)

          // Fetch group lessons + individual lessons in parallel
          const [groupRes, indivRes] = await Promise.all([
            groupIds.length > 0
              ? supabase.from('lessons')
                  .select('*, groups(name), teachers(profiles(full_name)), topics(title,module_id,modules(title))')
                  .in('group_id', groupIds)
                  .eq('format', 'group')
                  .order('scheduled_at', { ascending: true })
              : Promise.resolve({ data: [] }),
            supabase.from('lessons')
              .select('*, teachers(profiles(full_name)), topics(title,module_id,modules(title))')
              .eq('format', 'individual')
              .eq('student_id', profile!.id)
              .order('scheduled_at', { ascending: true }),
          ])

          const combined = [
            ...((groupRes as any).data || []),
            ...((indivRes.data) || []),
          ].sort((a: any, b: any) => a.scheduled_at.localeCompare(b.scheduled_at))

          setLessons(combined as Lesson[])

        } else if (profile!.role === 'teacher') {
          const { data: teacher } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()

          if (!teacher) { setLoading(false); return }

          const { data } = await supabase
            .from('lessons')
            .select('*, groups(name), topics(title,module_id,modules(title)), student:student_id(full_name,avatar_url)')
            .eq('teacher_id', teacher.id)
            .order('scheduled_at', { ascending: true })

          setLessons((data || []).map((l: any) => ({
            ...l, student_profile: l.student || null,
          })) as Lesson[])

        } else if (profile!.role === 'parent') {
          const { data: parent } = await supabase
            .from('parents').select('id').eq('profile_id', profile!.id).single()
          if (!parent) { setLoading(false); return }

          const { data: ps } = await supabase
            .from('parent_students').select('students(id)').eq('parent_id', parent.id)

          const studentIds = (ps || []).map((p: any) => p.students?.id).filter(Boolean)
          if (studentIds.length === 0) { setLessons([]); setLoading(false); return }

          const { data: gs } = await supabase
            .from('group_students').select('group_id').in('student_id', studentIds)

          const groupIds = [...new Set((gs || []).map((g: any) => g.group_id))]
          if (groupIds.length === 0) { setLessons([]); setLoading(false); return }

          const [groupRes2, indivRes2] = await Promise.all([
            groupIds.length > 0
              ? supabase.from('lessons')
                  .select('*, groups(name), teachers(profiles(full_name)), topics(title,module_id,modules(title))')
                  .in('group_id', groupIds).eq('format', 'group')
                  .order('scheduled_at', { ascending: true })
              : Promise.resolve({ data: [] }),
            supabase.from('lessons')
              .select('*, teachers(profiles(full_name)), topics(title,module_id,modules(title)), student:student_id(full_name,avatar_url)')
              .eq('format', 'individual').in('student_id', studentIds)
              .order('scheduled_at', { ascending: true }),
          ])
          const combined2 = [
            ...((groupRes2 as any).data || []),
            ...((indivRes2.data || []).map((l: any) => ({ ...l, student_profile: l.student || null }))),
          ].sort((a: any, b: any) => a.scheduled_at.localeCompare(b.scheduled_at))
          setLessons(combined2 as Lesson[])

        } else {
          // curator, admin, owner — all lessons
          const { data } = await supabase
            .from('lessons')
            .select('*, groups(name), teachers(profiles(full_name)), topics(title,module_id,modules(title)), student:student_id(full_name,avatar_url)')
            .order('scheduled_at', { ascending: true })

          setLessons((data || []).map((l: any) => ({
            ...l, student_profile: l.student || null,
          })) as Lesson[])
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile, tick])

  return { lessons, loading, reload }
}
