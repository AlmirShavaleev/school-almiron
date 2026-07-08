import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { VariantResultRow } from '@/utils/variantResultsUtils'

interface UseVariantResultsReturn {
  rows:    VariantResultRow[]
  loading: boolean
  error:   string | null
  refresh: () => void
}

export function useVariantResults(variantId: string | undefined): UseVariantResultsReturn {
  const [rows, setRows]       = useState<VariantResultRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [tick, setTick]       = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!variantId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(supabase as any)
      .rpc('get_variant_results', { p_variant_id: variantId })
      .then(({ data, error: err }: { data: VariantResultRow[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setRows([])
        } else {
          setRows(data ?? [])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [variantId, tick])

  return { rows, loading, error, refresh }
}
