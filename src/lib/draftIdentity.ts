import { useEffect } from 'react'
import { useAuthStore, type AuthState } from '@/store/authStore'

export function confirmedStudentId(state: AuthState): string | null {
  const id = state.user?.id
  const session = state.session
  if (!id || !session || state.loading || session.user?.id !== id || state.profile?.id !== id ||
      state.profile.role !== 'student' || (session.expires_at != null && session.expires_at * 1000 <= Date.now())) return null
  return id
}

export function useConfirmedStudentId(): string | null {
  return useAuthStore(confirmedStudentId)
}

export function captureAuthOperation(): () => void {
  const epoch = useAuthStore.getState?.()?.identityEpoch
  return () => {
    const state = useAuthStore.getState?.()
    const expires = state?.session?.expires_at
    if (state?.identityEpoch !== epoch || (expires != null && expires * 1000 <= Date.now())) {
      throw new Error('Сессия изменилась. Откройте работу заново.')
    }
  }
}

export function useSessionExpiry(onExpire?: () => void) {
  const session = useAuthStore(state => state.session)
  useEffect(() => {
    if (session?.expires_at == null) return
    const expiresAt = session.expires_at * 1000
    function expire() {
      const active = useAuthStore.getState()
      if (Date.now() < expiresAt || active.session !== session) return
      onExpire?.()
      active.reset()
    }
    const deadline = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()))
    window.addEventListener('focus', expire)
    window.addEventListener('pageshow', expire)
    return () => {
      window.clearTimeout(deadline)
      window.removeEventListener('focus', expire)
      window.removeEventListener('pageshow', expire)
    }
  }, [session, onExpire])
}
