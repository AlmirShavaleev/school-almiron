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

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'

// Auth pages
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'

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
import { GroupDetailPage } from '@/pages/GroupDetailPage'
import { TeacherDetailPage } from '@/pages/TeacherDetailPage'
import { LessonDetailPage } from '@/pages/LessonDetailPage'
import { HomeworkDetailPage } from '@/pages/HomeworkDetailPage'
import { HomeworkReviewPage } from '@/pages/HomeworkReviewPage'
import { StudentReviewPage } from '@/pages/StudentReviewPage'
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

    async function loadProfile(userId: string) {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (!cancelled && data) setProfile(data as any)
      if (!cancelled) setLoading(false)
    }

    // Initialise from persisted session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for subsequent auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfile(session.user.id)
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
      <Routes>
        {/* Public */}
        <Route path="/"               element={<RootRedirect />} />
        <Route path="/pricing"        element={<PricingPage />} />
        <Route path="/payment-result" element={<PaymentResultPage />} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Protected — dashboard layout */}
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/teacher" element={<TeacherDashboard />} />
          <Route path="/curator" element={<CuratorDashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/owner" element={<OwnerDashboard />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />
          <Route path="/teachers/:id" element={<TeacherDetailPage />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/:id" element={<LessonDetailPage />} />
          <Route path="/homeworks" element={<HomeworksPage />} />
          <Route path="/homeworks/:id" element={<HomeworkDetailPage />} />
          <Route path="/homeworks/:id/review" element={<HomeworkReviewPage />} />
          <Route path="/homeworks/:id/review/:studentId" element={<StudentReviewPage />} />
          <Route path="/mock-exams" element={<MockExamsPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/course-program" element={<CourseProgramPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/my-course" element={<MyCoursesPage />} />
          <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
          <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
          <Route path="/students/:id" element={<StudentProfilePage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/my-progress" element={<MyProgressPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
