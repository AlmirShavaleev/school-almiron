import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'

/**
 * Provides auth action methods only (signIn/signOut/signUp/resetPassword).
 * Auth state initialisation lives exclusively in AppAuth (App.tsx) to avoid
 * duplicate listeners and race-conditions on profile load.
 */
export function useAuth() {
  const { user, profile, loading, reset } = useAuthStore()

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signUp(email: string, password: string, fullName: string, role: UserRole = 'student') {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (!error && data.user) {
      await supabase.from('profiles').insert([{
        id: data.user.id,
        email,
        full_name: fullName,
        role,
      }] as any)
    }
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    reset()
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error }
  }

  return { user, profile, loading, role: profile?.role, signIn, signUp, signOut, resetPassword }
}

export function useRequireAuth(allowedRoles?: UserRole[]) {
  const { profile, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) {
      if (!profile) {
        navigate('/login')
      } else if (allowedRoles && !allowedRoles.includes(profile.role)) {
        navigate('/dashboard')
      }
    }
  }, [profile, loading, navigate, allowedRoles])

  return { profile, loading }
}
