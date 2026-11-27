import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useEffectiveRole } from '@/store/staffModeStore'
import { ownStudentRow } from '@/lib/ownStudent'

export function useGroups(enabled = true) {
  const profile = useAuthStore(s => s.profile)
  // Роль ПРЕДСТАВЛЕНИЯ, а не из профиля: владелец в режиме учителя видит
  // только своё. Под админской RLS база отдаёт ему всю школу, поэтому
  // сужение стоит в запросе клиента. На права это не влияет (§77).
  const effectiveRole = useEffectiveRole()
  const [groups,  setGroups]  = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !enabled) return
    setLoading(true)

    async function load() {
      try {
        const role = effectiveRole ?? profile!.role

        const baseSelect = '*, courses(title,subject,exam_type,is_template,is_active,is_draft), group_students(student_id,students(is_active,profiles(full_name))), teachers(profiles(full_name), is_active), curators(profiles(full_name), is_active)'

        if (role === 'student') {
          const { data: st } = await ownStudentRow(profile!.id)
          if (!st) return
          const { data: gs } = await supabase
            .from('group_students').select('group_id').eq('student_id', st.id)
          const ids = (gs || []).map((g: any) => g.group_id)
          if (!ids.length) { setGroups([]); return }
          const { data } = await supabase
            .from('groups').select(baseSelect).in('id', ids).eq('is_active', true)
          setGroups(addCount(data))

        } else if (role === 'teacher') {
          const { data: teacher } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!teacher) { setGroups([]); return }
          const { data } = await supabase
            .from('groups').select(baseSelect).eq('teacher_id', teacher.id).order('name')
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
  }, [profile, effectiveRole, tick, enabled])

  return { groups, loading, reload }
}

function addCount(data: any[] | null) {
  return (data || []).map(g => ({
    ...g,
    student_count: g.group_students?.length || 0,
  }))
}
