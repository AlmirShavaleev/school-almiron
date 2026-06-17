import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface GroupStudent {
  student_id: string
  full_name:  string
  avatar_url: string | null
  email:      string
}

export function useGroupManagement(groupId: string | null) {
  const [members,  setMembers]  = useState<GroupStudent[]>([])
  const [loading,  setLoading]  = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!groupId) return
    setLoading(true)

    supabase
      .from('group_students')
      .select('student_id, students(id, profiles(full_name, avatar_url, email))')
      .eq('group_id', groupId)
      .then(({ data }) => {
        setMembers(
          (data || []).map((gs: any) => ({
            student_id: gs.student_id,
            full_name:  gs.students?.profiles?.full_name || '—',
            avatar_url: gs.students?.profiles?.avatar_url || null,
            email:      gs.students?.profiles?.email || '',
          }))
        )
        setLoading(false)
      })
  }, [groupId, tick])

  async function addStudent(studentId: string) {
    if (!groupId) return
    const { error } = await supabase
      .from('group_students')
      .insert({ group_id: groupId, student_id: studentId })
    if (error) throw new Error(error.message)
    reload()
  }

  async function removeStudent(studentId: string) {
    if (!groupId) return
    const { error } = await supabase
      .from('group_students')
      .delete()
      .eq('group_id', groupId)
      .eq('student_id', studentId)
    if (error) throw new Error(error.message)
    reload()
  }

  // Search students not yet in this group
  async function searchStudents(query: string): Promise<GroupStudent[]> {
    if (!query.trim()) return []

    const { data } = await supabase
      .from('students')
      .select('id, profiles(full_name, avatar_url, email)')
      .ilike('profiles.full_name', `%${query}%`)
      .limit(20)

    const memberIds = new Set(members.map(m => m.student_id))

    return (data || [])
      .filter((s: any) => s.profiles && !memberIds.has(s.id))
      .map((s: any) => ({
        student_id: s.id,
        full_name:  s.profiles.full_name,
        avatar_url: s.profiles.avatar_url || null,
        email:      s.profiles.email || '',
      }))
  }

  return { members, loading, addStudent, removeStudent, searchStudents, reload }
}
