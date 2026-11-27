import { hasUnsafeDrafts } from './studentDrafts'
import { BUILD_ID } from './buildVersion'

export type ReleaseStatus = 'current' | 'updated' | 'offline' | 'unavailable'

let pending: Promise<ReleaseStatus> | undefined

export function checkRelease(): Promise<ReleaseStatus> {
  if (pending) return pending
  pending = (async (): Promise<ReleaseStatus> => {
    if (!navigator.onLine) return 'offline'
    if (BUILD_ID === 'dev') return 'current'
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 4_000)
    try {
      const response = await fetch('/version.json', { cache: 'no-store', signal: abort.signal })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return 'unavailable'
      const version: { build_id?: unknown } | null = await response.json().catch(() => null)
      const id = version?.build_id
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return 'unavailable'
      return id === BUILD_ID ? 'current' : 'updated'
    } catch {
      return 'offline'
    } finally {
      clearTimeout(timeout)
    }
  })().finally(() => { pending = undefined })
  return pending
}

export function requestPageReload(beforeReload?: () => void): boolean {
  if (hasUnsafeDrafts()) return false
  beforeReload?.()
  window.location.reload()
  return true
}

// Open tabs from the old release can still navigate with its cache-busting parameter.
export function stripLegacyReloadParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('_r')) return
  url.searchParams.delete('_r')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}
