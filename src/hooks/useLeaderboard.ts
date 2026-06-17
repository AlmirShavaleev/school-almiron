import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface LeaderboardEntry {
  id: string
  profile_id: string
  xp_points: number
  league: string
  full_name: string
  rank: number
}

export function useLeaderboard() {
  const [entries,  setEntries]  = useState<LeaderboardEntry[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from('students')
          .select('id, profile_id, xp_points, league, profiles(full_name)')
          .order('xp_points', { ascending: false })

        const ranked = (data || []).map((s: any, i: number) => ({
          id:         s.id,
          profile_id: s.profile_id,
          xp_points:  s.xp_points,
          league:     s.league,
          full_name:  s.profiles?.full_name || '—',
          rank:       i + 1,
        }))
        setEntries(ranked)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return { entries, loading }
}
