import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HomeworkV2Row } from '@/types/homeworkV2'

export type ReviewQueueMode = 'pending' | 'returned' | 'checked'

export function useHomeworkReviewQueueV2(mode: ReviewQueueMode, groupId?: string | null) {
  const [items, setItems] = useState<HomeworkV2Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_homework_review_queue_v2', {
          p_mode: mode,
          p_group_id: groupId ?? undefined,
          p_course_id: undefined,
          p_limit: 100,
        })
        if (cancelled) return
        if (err) { setError(err.message); setItems([]); return }
        const items = (data as { items?: unknown[] } | null)?.items ?? []
        setItems(items as unknown as HomeworkV2Row[])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mode, groupId, tick])

  return { items, loading, error, reload }
}
