import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useHomeworks() {
  const profile = useAuthStore(s => s.profile)
  const [homeworks, setHomeworks] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [tick, setTick]           = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    setLoading(true)

    // Темы курсов → их id (ДЗ привязаны к темам)
    async function topicIdsForCourses(courseIds: string[]): Promise<string[]> {
      if (!courseIds.length) return []
      const { data: mods } = await supabase
        .from('modules').select('topics(id)').in('course_id', courseIds)
      return (mods || []).flatMap((m: any) => (m.topics || []).map((t: any) => t.id))
    }

    function attachSubs(hws: any[], subs: any[]) {
      const byHw: Record<string, any[]> = {}
      for (const s of subs || []) (byHw[s.homework_id] ||= []).push(s)
      return hws.map(hw => ({ ...hw, homework_submissions: byHw[hw.id] || [] }))
    }

    async function load() {
      try {
        const role = profile!.role

        if (role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!st) { setHomeworks([]); return }

          const { data: gs } = await supabase
            .from('group_students').select('groups(course_id)').eq('student_id', st.id)
          const courseIds = [...new Set((gs || []).map((r: any) => r.groups?.course_id).filter(Boolean))]
          const topicIds = await topicIdsForCourses(courseIds)
          if (!topicIds.length) { setHomeworks([]); return }

          const { data } = await supabase
            .from('homeworks')
            .select('*, topics(title), homework_submissions(status,score,feedback,submitted_at,student_id)')
            .in('topic_id', topicIds)
            .order('due_date', { ascending: true })
          // оставить только сдачи этого ученика
          setHomeworks((data || []).map((hw: any) => ({
            ...hw,
            homework_submissions: (hw.homework_submissions || []).filter((s: any) => s.student_id === st.id),
          })))

        } else if (role === 'teacher') {
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!tc) { setHomeworks([]); return }

          const { data: hws } = await supabase
            .from('homeworks')
            .select('*, topics(title)')
            .eq('created_by', tc.id)
            .order('due_date', { ascending: false })
          if (!hws?.length) { setHomeworks([]); return }

          const { data: subs } = await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, student_id, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hws.map((h: any) => h.id))
          setHomeworks(attachSubs(hws, subs || []))

        } else if (role === 'curator') {
          const { data: cur } = await supabase
            .from('curators').select('id').eq('profile_id', profile!.id).single()
          if (!cur) { setHomeworks([]); return }

          const { data: grps } = await supabase
            .from('groups').select('course_id').eq('curator_id', cur.id)
          const courseIds = [...new Set((grps || []).map((g: any) => g.course_id).filter(Boolean))]
          const topicIds = await topicIdsForCourses(courseIds)
          if (!topicIds.length) { setHomeworks([]); return }

          const { data: hws } = await supabase
            .from('homeworks')
            .select('*, topics(title)')
            .in('topic_id', topicIds)
            .order('due_date', { ascending: false })
          if (!hws?.length) { setHomeworks([]); return }

          const { data: subs } = await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, student_id, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hws.map((h: any) => h.id))
          setHomeworks(attachSubs(hws, subs || []))

        } else {
          // admin / owner
          const { data } = await supabase
            .from('homeworks')
            .select('*, topics(title), homework_submissions(status,score,student_id,submitted_at,checked_at,students(profiles(full_name)))')
            .order('due_date', { ascending: false })
          setHomeworks(data || [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile, tick])

  return { homeworks, loading, reload }
}
