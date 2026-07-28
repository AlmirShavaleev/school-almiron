import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect, Component, Suspense, lazy, type ReactNode } from 'react'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">
            <h1 className="text-xl font-bold text-red-600 mb-3">Ошибка приложения</h1>
            <pre className="text-sm text-gray-700 bg-gray-50 p-4 rounded-lg overflow-auto whitespace-pre-wrap">
              {(this.state.error as Error).message}
              {'\n\n'}
              {(this.state.error as Error).stack}
            </pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm"
              onClick={() => window.location.reload()}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Toaster } from '@/components/ui/Toaster'
import { getPendingInvitePath, hasPendingInvite } from '@/lib/studentInviteSession'
import { getPendingTeacherJoinLinkPath } from '@/lib/teacherJoinLinkSession'

// Auth pages
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { JoinPage } from '@/pages/JoinPage'
import { JoinTeacherPage } from '@/pages/JoinTeacherPage'

// Public — lazy-loaded so framer-motion + landing components stay out of the main chunk
const LandingPage       = lazy(() => import('@/pages/LandingPage').then(m => ({ default: m.LandingPage })))
const PricingPage       = lazy(() => import('@/pages/PricingPage').then(m => ({ default: m.PricingPage })))
const PaymentResultPage = lazy(() => import('@/pages/PaymentResultPage').then(m => ({ default: m.PaymentResultPage })))

// Protected app subtree (DashboardLayout + all its child routes) — lazy so its page code stays out of the entry chunk
const AppRoutes = lazy(() => import('@/AppRoutes'))

/** Полноэкранный спиннер — общий для loading-состояния и Suspense-фолбэка. */
function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

/** `/` → дашборд если залогинен, иначе лендинг */
function RootRedirect() {
  const { profile, user, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    // This is where Supabase's email-confirmation link lands (emailRedirectTo = origin + "/").
    // A pending teacher-join-link intent must be checked here too, not just on /login --
    // otherwise the confirmation redirect drops the user straight onto /dashboard and the
    // join request never gets submitted until they manually reopen the /jt/:token link.
    const pendingPath = getPendingInvitePath() || getPendingTeacherJoinLinkPath()
    if (pendingPath && (profile || user)) {
      navigate(pendingPath, { replace: true })
      return
    }
    if (profile) navigate('/dashboard', { replace: true })
  }, [profile, user, loading, navigate])

  if (loading) return <FullScreenSpinner />
  if (profile || (user && (getPendingInvitePath() || getPendingTeacherJoinLinkPath()))) return null

  return <LandingPage />
}

/**
 * Field-by-field diff of two profile rows (Object.keys of both sides, not a
 * hardcoded field list — a new `profiles` column must show up in the diff
 * automatically, not silently compare as "unchanged").
 */
function profilesEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/**
 * Single source of truth for auth state.
 * Runs once at app level — no duplicate listeners.
 */
export function AppAuth() {
  const { setUser, setSession, setProfile, setLoading, reset } = useAuthStore()

  useEffect(() => {
    let cancelled = false

    async function loadProfile(user: { id: string; email?: string; user_metadata?: any }) {
      let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      // Самозарегистрированный пользователь без профиля (email-подтверждение) →
      // создаём профиль роли student. RLS разрешает само-вставку ТОЛЬКО role='student'.
      if (!data && !hasPendingInvite()) {
        await supabase.from('profiles').insert({
          id:        user.id,
          email:     user.email || '',
          full_name: user.user_metadata?.full_name || '',
          role:      'student',
        } as any)
        const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        data = res.data
      }
      // Same auth event fires on every token refresh (periodic, unrelated to
      // profile content). Skip setProfile when the row is byte-for-byte the
      // same as what's already in the store — a fresh object reference here
      // ripples into every `useEffect`/`useMemo` that has `profile` (not
      // `profile?.id`) in its deps array and re-triggers it for nothing.
      if (!cancelled && data && !profilesEqual(useAuthStore.getState().profile as any, data as any)) {
        setProfile(data as any)
      }
      if (!cancelled && !data) setProfile(null)
      if (!cancelled) setLoading(false)
    }

    // Initialise from persisted session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user)
      else setLoading(false)
    })

    // Listen for subsequent auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfile(session.user)
      } else if (event === 'SIGNED_OUT') {
        reset()
        setLoading(false)
      } else {
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  // Store setters are stable references from zustand — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AppAuth />
      <Toaster />
      <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        {/* Public */}
        <Route path="/"               element={<RootRedirect />} />
        <Route path="/pricing"        element={<PricingPage />} />
        <Route path="/payment-result" element={<PaymentResultPage />} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/jt/:token" element={<JoinTeacherPage />} />

        {/* Protected app subtree — lazy chunk, own nested <Routes> (see AppRoutes.tsx) */}
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
