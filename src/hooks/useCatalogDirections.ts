import { useQuery } from '@tanstack/react-query'
import { isCatalogLockedError } from '@/lib/catalogLock'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

type CatalogAccessRpc = {
  rpc: (name: string, args: Record<string, never>) => PromiseLike<{
    data: unknown
    error: { message?: string; hint?: string | null } | null
  }>
}

async function fetchDirections(): Promise<string[]> {
  const { data, error } = await (supabase as unknown as CatalogAccessRpc).rpc('catalog_subscription_directions', {})
  if (isCatalogLockedError(error)) return []
  if (error || !Array.isArray(data) || !data.every(item => typeof item === 'string')) {
    throw new Error(error?.message ?? 'Не удалось проверить доступ к каталогу')
  }
  return data
}

export function useCatalogDirections() {
  const profile = useAuthStore(state => state.profile)
  const query = useQuery({
    queryKey: ['catalog-directions', profile?.id, profile?.role],
    enabled: Boolean(profile?.id),
    queryFn: fetchDirections,
    staleTime: query => query.state.data?.length ? 60_000 : 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return { directions: query.data, loading: query.isLoading, error: query.isError, retry: query.refetch }
}
