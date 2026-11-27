import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile, UserRole } from '@/types'

export interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  identityEpoch: number
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
  role: UserRole | null
}

// ⚠️ Безопасность: профиль/роль НЕ персистятся в localStorage (вектор stale-role / спуфинга).
// Профиль всегда загружается заново из БД (AppAuth.loadProfile) в каждой сессии.
export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  identityEpoch: 0,
  get role() {
    return get().profile?.role ?? null
  },
  setUser: (user) => set(state => state.user?.id === user?.id
    ? { user }
    : { user, profile: null, loading: !!user, identityEpoch: state.identityEpoch + 1 }),
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),
  reset: () => set(state => ({
    user: null, session: null, profile: null, loading: false,
    identityEpoch: state.identityEpoch + (state.user || state.profile ? 1 : 0),
  })),
}))
