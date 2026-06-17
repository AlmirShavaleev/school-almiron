import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export function useMockExams(tick = 0) {
  const profile = useAuthStore(s => s.profile)
  const [exams,    setExams]   = useState<any[]>([])
  const [myResults, setMyResults] = useState<any[]>([])
  const [loading,  setLoading] = useState(true)

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

          // Student sees their own results joined with exam info
          const { data: results } = await supabase
            .from('mock_exam_results')
            .select('*, mock_exams(*, groups(name))')
            .eq('student_id', st.id)
            .order('created_at', { ascending: true })
          setMyResults(results || [])
          setExams((results || []).map((r: any) => r.mock_exams).filter(Boolean))

        } else if (role === 'teacher') {
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (!tc) return

          const { data } = await supabase
            .from('mock_exams')
            .select('*, groups(name), mock_exam_results(student_id,score,students(profiles(full_name)))')
            .eq('created_by', tc.id)
            .order('date', { ascending: false })
          setExams(data || [])

        } else {
          const { data } = await supabase
            .from('mock_exams')
            .select('*, groups(name), mock_exam_results(student_id,score,students(profiles(full_name)))')
            .order('date', { ascending: false })
          setExams(data || [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile, tick])

  return { exams, myResults, loading }
}
