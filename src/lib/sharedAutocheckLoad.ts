/**
 * Coalesce identical autocheck reads across page + navigation-badge hooks.
 * Keys must include both auth identity and student id; no cross-account reuse.
 *
 * Completed results are reused briefly during navigation, then reloaded.
 * Never persist answers to storage. On failure callers should retry quickly.
 */
const FINISHED_TTL_MS = 1000
const MAX_ENTRIES = 32

type CacheEntry<T> = {
  promise: Promise<T>
  expiresAt: number
  inFlight: boolean
}

const cache = new Map<string, CacheEntry<unknown>>()

/** Share a pending fetch, and a briefly completed one, by exact user + topics. */
export function shareAutocheckLoad<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const cached = cache.get(key) as CacheEntry<T> | undefined
  if (cached && (cached.inFlight || cached.expiresAt > now)) return cached.promise
  if (cached) cache.delete(key)

  // Keep this tiny across many different course/topic subsets.
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }

  const entry: CacheEntry<T> = {
    promise: Promise.resolve().then(fetcher),
    expiresAt: Number.POSITIVE_INFINITY,
    inFlight: true,
  }
  cache.set(key, entry as CacheEntry<unknown>)
  entry.promise.then(
    () => {
      entry.inFlight = false
      entry.expiresAt = Date.now() + FINISHED_TTL_MS
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key)
    },
  )
  return entry.promise
}

/** Explicit invalidation for future mutations, logout, or forced refreshes. */
export function invalidateSharedAutocheckLoads(prefix = ''): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
