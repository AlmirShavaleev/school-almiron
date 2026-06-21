import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, Component, type ReactNode } from 'react'

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

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Auth pages
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'

// Public
import { LandingPage }       from '@/pages/LandingPage'
import { PricingPage }       from '@/pages/PricingPage'
import { PaymentResultPage } from '@/pages/PaymentResultPage'

// Dashboard
import { DashboardPage } from '@/pages/DashboardPage'

// Role dashboards
import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import { CuratorDashboard } from '@/pages/curator/CuratorDashboard'
import { AdminDashboard } from '@/pages/admin/AdminDashboard'
import { OwnerDashboard } from '@/pages/owner/OwnerDashboard'

// Shared pages
import { GroupsPage } from '@/pages/GroupsPage'
import { GroupControlPanel } from '@/pages/GroupControlPanel'
import { TeacherDetailPage } from '@/pages/TeacherDetailPage'
import { LessonDetailPage } from '@/pages/LessonDetailPage'
import { HomeworkDetailPage } from '@/pages/HomeworkDetailPage'
import { HomeworkReviewPage } from '@/pages/HomeworkReviewPage'
import { StudentReviewPage } from '@/pages/StudentReviewPage'
import { HomeworkQueuePage } from '@/pages/HomeworkQueuePage'
import { LessonsPage } from '@/pages/LessonsPage'
import { HomeworksPage } from '@/pages/HomeworksPage'
import { MockExamsPage } from '@/pages/MockExamsPage'
import { PaymentsPage } from '@/pages/PaymentsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { CourseProgramPage } from '@/pages/CourseProgramPage'
import { AttendancePage } from '@/pages/AttendancePage'
import { MyCoursesPage } from '@/pages/MyCoursesPage'
import { StudentCoursePage } from '@/pages/StudentCoursePage'
import { TopicPage } from '@/pages/TopicPage'
import { StudentProfilePage } from '@/pages/StudentProfilePage'
import { SchedulePage } from '@/pages/SchedulePage'
import { MyProgressPage } from '@/pages/student/MyProgressPage'

/** `/` → дашборд если залогинен, иначе лендинг */
function RootRedirect() {
  const { profile, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (profile) navigate('/dashboard', { replace: true })
  }, [profile, loading, navigate])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (profile) return null   // сейчас переходим на /dashboard

  return <LandingPage />
}

/**
 * Single source of truth for auth state.
 * Runs once at app level — no duplicate listeners.
 */
function AppAuth() {
  const { setUser, setSession, setProfile, setLoading, reset } = useAuthStore()

  useEffect(() => {
    let cancelled = false

    async function loadProfile(user: { id: string; email?: string; user_metadata?: any }) {
      let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      // Самозарегистрированный пользователь без профиля (email-подтверждение) →
      // создаём профиль роли student. RLS разрешает само-вставку ТОЛЬКО role='student'.
      if (!data) {
        await supabase.from('profiles').insert({
          id:        user.id,
          email:     user.email || '',
          full_name: user.user_metadata?.full_name || '',
          role:      'student',
        } as any)
        const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        data = res.data
      }
      if (!cancelled && data) setProfile(data as any)
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
      <Routes>
        {/* Public */}
        <Route path="/"               element={<RootRedirect />} />
        <Route path="/pricing"        element={<PricingPage />} />
        <Route path="/payment-result" element={<PaymentResultPage />} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />

        {/* Protected — dashboard layout */}
        <Route element={<DashboardLayout />}>
          {/* Доступно всем авторизованным */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />

          {/* Дашборды по ролям */}
          <Route path="/student" element={<RoleGuard allow={['student']}><StudentDashboard /></RoleGuard>} />
          <Route path="/teacher" element={<RoleGuard allow={['teacher','admin','owner']}><TeacherDashboard /></RoleGuard>} />
          <Route path="/curator" element={<RoleGuard allow={['curator','admin','owner']}><CuratorDashboard /></RoleGuard>} />
          <Route path="/admin" element={<RoleGuard allow={['admin','owner']}><AdminDashboard /></RoleGuard>} />
          <Route path="/owner" element={<RoleGuard allow={['owner']}><OwnerDashboard /></RoleGuard>} />

          {/* Только персонал (teacher/curator/admin/owner) */}
          <Route path="/groups" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupsPage /></RoleGuard>} />
          <Route path="/groups/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupControlPanel /></RoleGuard>} />
          <Route path="/teachers/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TeacherDetailPage /></RoleGuard>} />
          <Route path="/students/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentProfilePage /></RoleGuard>} />
          <Route path="/course-program" element={<RoleGuard allow={['teacher','admin','owner']}><CourseProgramPage /></RoleGuard>} />
          <Route path="/attendance" element={<RoleGuard allow={['teacher','curator','admin','owner']}><AttendancePage /></RoleGuard>} />
          <Route path="/schedule" element={<RoleGuard allow={['teacher','curator','admin','owner']}><SchedulePage /></RoleGuard>} />
          <Route path="/inbox" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkQueuePage /></RoleGuard>} />
          <Route path="/lessons/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><LessonDetailPage /></RoleGuard>} />
          <Route path="/homeworks/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkDetailPage /></RoleGuard>} />
          <Route path="/homeworks/:id/review/:groupId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewPage /></RoleGuard>} />
          <Route path="/homeworks/:id/review/:groupId/:studentId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentReviewPage /></RoleGuard>} />

          {/* Списки, общие для student (своё) и персонала */}
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/homeworks" element={<HomeworksPage />} />
          <Route path="/mock-exams" element={<MockExamsPage />} />

          {/* Только ученик */}
          <Route path="/my-course" element={<RoleGuard allow={['student']}><MyCoursesPage /></RoleGuard>} />
          <Route path="/my-course/:groupId" element={<RoleGuard allow={['student']}><StudentCoursePage /></RoleGuard>} />
          <Route path="/my-course/:groupId/topic/:topicId" element={<RoleGuard allow={['student']}><TopicPage /></RoleGuard>} />
          <Route path="/my-progress" element={<RoleGuard allow={['student']}><MyProgressPage /></RoleGuard>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
