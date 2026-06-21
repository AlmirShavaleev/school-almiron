import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useGroups() {
  const profile = useAuthStore(s => s.profile)
  const [groups,  setGroups]  = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    setLoading(true)

    async function load() {
      try {
        const role = profile!.role

        const baseSelect = '*, courses(title,subject,exam_type), group_students(student_id,students(profiles(full_name))), teachers(profiles(full_name), is_active), curators(profiles(full_name), is_active)'

        if (role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!st) return
          const { data: gs } = await supabase
            .from('group_students').select('group_id').eq('student_id', st.id)
          const ids = (gs || []).map((g: any) => g.group_id)
          if (!ids.length) { setGroups([]); return }
          const { data } = await supabase
            .from('groups').select(baseSelect).in('id', ids).eq('is_active', true)
          setGroups(addCount(data))

        } else if (role === 'teacher') {
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!tc) return
          const { data } = await supabase
            .from('groups').select(baseSelect).eq('teacher_id', tc.id).eq('is_active', true)
          setGroups(addCount(data))

        } else if (role === 'curator') {
          const { data: cur } = await supabase
            .from('curators').select('id').eq('profile_id', profile!.id).single()
          if (!cur) return
          const { data } = await supabase
            .from('groups').select(baseSelect).eq('curator_id', cur.id).eq('is_active', true)
          setGroups(addCount(data))

        } else {
          const { data } = await supabase
            .from('groups').select(baseSelect).order('name')
          setGroups(addCount(data))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile, tick])

  return { groups, loading, reload }
}

function addCount(data: any[] | null) {
  return (data || []).map(g => ({
    ...g,
    student_count: g.group_students?.length || 0,
  }))
}
