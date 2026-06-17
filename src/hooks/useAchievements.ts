import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  xp_reward: number
  condition_type: string
  condition_value: number
  earned: boolean
  earned_at?: string
}

export function useAchievements() {
  const profile = useAuthStore(s => s.profile)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    setLoading(true)

    async function load() {
      try {
        // Fetch all achievements
        const { data: all } = await supabase
          .from('achievements')
          .select('*')
          .order('xp_reward', { ascending: false })

        // For students — fetch their earned achievements
        let earnedIds: Set<string> = new Set()
        let earnedMap: Record<string, string> = {} // id → earned_at

        if (profile!.role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (st) {
            const { data: sa } = await supabase
              .from('student_achievements')
              .select('achievement_id, earned_at')
              .eq('student_id', st.id)
            for (const row of sa || []) {
              earnedIds.add(row.achievement_id)
              earnedMap[row.achievement_id] = row.earned_at
            }
          }
        }

        setAchievements(
          (all || []).map(a => ({
            ...a,
            earned: earnedIds.has(a.id),
            earned_at: earnedMap[a.id],
          }))
        )
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile])

  return { achievements, loading }
}
