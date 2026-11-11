const KEY='almiron:tutoring-intent'
export function rememberTutoringIntent() { try { localStorage.setItem(KEY,String(Date.now())) } catch { /* private browsing */ } }
export function clearTutoringIntent() { try { localStorage.removeItem(KEY) } catch { /* private browsing */ } }
export function getPendingTutoringPath(role?: string|null): string|null {
 try {
  const stamp=Number(localStorage.getItem(KEY))
  if (!stamp || Date.now()-stamp>86400000 || (role && role!=='student')) { clearTutoringIntent();return null }
  return '/tutoring'
 } catch {return null}
}
