import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function mergeTeacherScopedHomeworks(owned: any[], groupCourse: any[]) {
  const byId = new Map<string, any>()
  for (const hw of [...owned, ...groupCourse]) byId.set(hw.id, hw)
  return [...byId.values()].sort((a, b) =>
    new Date(b.due_date || 0).getTime() - new Date(a.due_date || 0).getTime()
  )
}

export function useHomeworks() {
  const profile = useAuthStore(s => s.profile)
  const [homeworks, setHomeworks] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [tick, setTick]           = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const inFlightRef = useRef(false)

  // Deps keyed on profile?.id/role (primitives), not the profile object
  // itself: AppAuth re-fetches and replaces `profile` with a brand-new
  // object reference on every auth event (including periodic token
  // refreshes), which kept re-triggering this whole effect from scratch —
  // same class of storm fixed for useHomeworkQueue, different source.
  useEffect(() => {
    if (!profile) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError(null)

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
            .select('*, topics(title), homework_submissions(id,status,score,feedback,submitted_at,student_id,file_url,answer_text)')
            .in('topic_id', topicIds)
            .eq('is_archived', false)
            .order('due_date', { ascending: true })
          // оставить только сдачи этого ученика
          setHomeworks((data || []).map((hw: any) => ({
            ...hw,
            homework_submissions: (hw.homework_submissions || []).filter((s: any) => s.student_id === st.id),
          })))

        } else if (role === 'teacher') {
          const { data: tc, error: teacherError } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (teacherError) throw teacherError
          if (!tc) { setHomeworks([]); return }

          // A legacy homework belongs to a course through topic -> module. A
          // teacher must see course homework for their groups even when an
          // admin or another teacher created it. Submission rows are scoped
          // back to students of this teacher's groups.
          const { data: groups, error: groupsError } = await supabase
            .from('groups')
            .select('course_id, group_students(student_id)')
            .eq('teacher_id', tc.id)
            .eq('is_active', true)
          if (groupsError) throw groupsError

          const courseIds = [...new Set((groups || []).map((g: any) => g.course_id).filter(Boolean))]
          const studentIds = [...new Set((groups || []).flatMap((g: any) =>
            (g.group_students || []).map((row: any) => row.student_id).filter(Boolean)
          ))]

          let groupTopicIds: string[] = []
          if (courseIds.length) {
            const { data: modules, error: modulesError } = await supabase
              .from('modules').select('topics(id)').in('course_id', courseIds)
            if (modulesError) throw modulesError
            groupTopicIds = (modules || []).flatMap((m: any) => (m.topics || []).map((t: any) => t.id))
          }

          const ownQuery = supabase.from('homeworks').select('*, topics(title)')
            .or(`created_by.eq.${tc.id},teacher_id.eq.${tc.id}`)
            .eq('is_archived', false)
          const groupQuery = groupTopicIds.length
            ? supabase.from('homeworks').select('*, topics(title)')
                .in('topic_id', groupTopicIds).eq('is_archived', false)
            : Promise.resolve({ data: [] as any[], error: null })
          const [ownResult, groupResult] = await Promise.all([ownQuery, groupQuery])
          if (ownResult.error) throw ownResult.error
          if (groupResult.error) throw groupResult.error

          const hws = mergeTeacherScopedHomeworks(ownResult.data || [], groupResult.data || [])
          if (!hws?.length) { setHomeworks([]); return }

          if (!studentIds.length) { setHomeworks(attachSubs(hws, [])); return }
          const { data: subs, error: submissionsError } = await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, student_id, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hws.map((h: any) => h.id))
            .in('student_id', studentIds)
          if (submissionsError) throw submissionsError
          setHomeworks(attachSubs(hws, subs || []))

        } else if (role === 'curator') {
          const { data: cur } = await supabase
            .from('curators').select('id').eq('profile_id', profile!.id).single()
          if (!cur) { setHomeworks([]); return }

          const { data: grps } = await supabase
            .from('groups').select('course_id').eq('curator_id', cur.id).eq('is_active', true)
          const courseIds = [...new Set((grps || []).map((g: any) => g.course_id).filter(Boolean))]
          const topicIds = await topicIdsForCourses(courseIds)
          if (!topicIds.length) { setHomeworks([]); return }

          const { data: hws } = await supabase
            .from('homeworks')
            .select('*, topics(title)')
            .in('topic_id', topicIds)
            .eq('is_archived', false)
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
            .eq('is_archived', false)
            .order('due_date', { ascending: false })
          setHomeworks(data || [])
        }
      } catch (loadError: any) {
        console.error('Не удалось загрузить домашние задания', loadError)
        setError(loadError?.message || 'Не удалось загрузить домашние задания')
        setHomeworks([])
      } finally {
        inFlightRef.current = false
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, tick])

  return { homeworks, loading, error, reload }
}
