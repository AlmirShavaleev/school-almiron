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

    async function load() {
      try {
        const role = profile!.role

        if (role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!st) return

          const { data: gs } = await supabase
            .from('group_students').select('group_id').eq('student_id', st.id)
          const groupIds = (gs || []).map((g: any) => g.group_id)
          if (!groupIds.length) { setHomeworks([]); return }

          const { data } = await supabase
            .from('homeworks')
            .select('*, groups(name), homework_submissions(status,score,feedback,submitted_at)')
            .in('group_id', groupIds)
            .order('due_date', { ascending: true })
          setHomeworks(data || [])

        } else if (role === 'teacher') {
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!tc) return

          const { data: hws } = await supabase
            .from('homeworks')
            .select('*, groups(name)')
            .eq('created_by', tc.id)
            .order('due_date', { ascending: false })
          if (!hws || hws.length === 0) { setHomeworks([]); return }

          const hwIds = hws.map((h: any) => h.id)
          const { data: subs } = await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, student_id, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hwIds)

          const subsByHw: Record<string, any[]> = {}
          for (const s of (subs || []) as any[]) {
            if (!subsByHw[s.homework_id]) subsByHw[s.homework_id] = []
            subsByHw[s.homework_id].push(s)
          }
          setHomeworks(hws.map((hw: any) => ({ ...hw, homework_submissions: subsByHw[hw.id] || [] })))

        } else if (role === 'curator') {
          const { data: cur } = await (supabase as any)
            .from('curators').select('id, group_id').eq('profile_id', profile!.id).single()
          if (!cur) return

          const { data: hws } = await supabase
            .from('homeworks')
            .select('*, groups(name)')
            .eq('group_id', cur.group_id)
            .order('due_date', { ascending: false })
          if (!hws || hws.length === 0) { setHomeworks([]); return }

          const hwIds = hws.map((h: any) => h.id)
          const { data: subs } = await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, student_id, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hwIds)

          const subsByHw: Record<string, any[]> = {}
          for (const s of (subs || []) as any[]) {
            if (!subsByHw[s.homework_id]) subsByHw[s.homework_id] = []
            subsByHw[s.homework_id].push(s)
          }
          setHomeworks(hws.map((hw: any) => ({ ...hw, homework_submissions: subsByHw[hw.id] || [] })))

        } else {
          // admin / owner — is_admin_or_owner() bypasses heavy RLS, embedded join is fine
          const { data } = await supabase
            .from('homeworks')
            .select('*, groups(name), homework_submissions(status,score,student_id,submitted_at,checked_at,students(profiles(full_name)))')
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
