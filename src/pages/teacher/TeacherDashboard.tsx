import { useNavigate } from 'react-router-dom'
import {
  Users, ArrowRight, ClipboardList, GraduationCap, BookOpen,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useTeacherDashboard } from '@/hooks/useTeacherDashboard'
import { formatDate } from '@/utils/format'

export function TeacherDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  const dashboard = useTeacherDashboard(profile?.id, profile?.role)
  const { loading } = dashboard
  // Та же подстраховка, что и в кабинете ученика: неполный ответ хука не
  // должен ронять первый экран после входа.
  const courses = dashboard.courses ?? []
  const pendingReviews = dashboard.pendingReviews ?? []
  const recentTests = dashboard.recentTests ?? []
  const stats = dashboard.stats ?? { courses: 0, students: 0, pendingReviews: 0, bankTests: 0 }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const firstName = profile?.full_name?.split(' ')[1] || profile?.full_name?.split(' ')[0] || 'Учитель'

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="platform-surface rounded-lg p-5 sm:p-6 overflow-hidden relative">
        <div className="absolute right-0 top-0 h-full w-56 bg-gradient-to-l from-primary-50/90 to-transparent pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
            <BookOpen size={13} />
            Кабинет преподавателя
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-graphite-950">
            Привет, {firstName}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Курсы"
          value={stats?.courses ?? 0}
          icon={<BookOpen size={20} />}
          color="blue"
        />
        <StatCard
          title="Ученики"
          value={stats?.students ?? 0}
          icon={<GraduationCap size={20} />}
          color="purple"
        />
        <StatCard
          title="Работ на проверке"
          value={stats?.pendingReviews ?? 0}
          icon={<ClipboardList size={20} />}
          color={(stats?.pendingReviews ?? 0) > 0 ? 'orange' : 'green'}
          subtitle={(stats?.pendingReviews ?? 0) === 0 ? 'Всё проверено' : 'ждут оценки'}
          onClick={() => navigate('/homework-queue')}
        />
        <StatCard
          title="Тестов в банке"
          value={stats?.bankTests ?? 0}
          icon={<BookOpen size={20} />}
          color="blue"
          onClick={() => navigate('/tests')}
        />
      </div>

      {/* ── Pending reviews banner ────────────────────────────────────────── */}
      {pendingReviews.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ждут проверки: {stats?.pendingReviews} работ</CardTitle>
            <button
              onClick={() => navigate('/homework-queue')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              Открыть очередь <ArrowRight size={12} />
            </button>
          </CardHeader>
          <div className="space-y-2">
            {pendingReviews.slice(0, 5).map(item => (
              <div key={item.attemptId} className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-orange-100 bg-orange-50/50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {item.studentName} · {item.hwTitle}
                  </div>
                  <div className="text-xs text-gray-400">
                    {item.submittedAt ? formatDate(item.submittedAt) : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <Button
              size="sm"
              onClick={() => navigate('/homework-queue')}
              className="w-full"
            >
              Открыть очередь
            </Button>
          </div>
        </Card>
      )}

      {/* ── My courses ────────────────────────────────────────────────────── */}
      {courses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Мои курсы</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {courses.map(course => (
              <div
                key={course.id}
                onClick={() => navigate('/course-program')}
                className="flex items-center justify-between py-3 px-3 rounded-xl border border-gray-100 hover:border-primary-200 hover:bg-primary-50/40 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{course.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {course.subject && (
                      <Badge variant="info" className="text-xs">{course.subject}</Badge>
                    )}
                    {course.exam_type && (
                      <Badge variant="info" className="text-xs">{course.exam_type}</Badge>
                    )}
                    {!course.is_active && (
                      <Badge variant="default" className="text-xs">Неактивен</Badge>
                    )}
                  </div>
                </div>
                <div className="ml-3 text-xs text-gray-500 shrink-0">
                  {course.studentCount} уч.
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Recent test results ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Последние результаты тестов</CardTitle>
          {recentTests.length > 0 && (
            <button
              onClick={() => navigate('/tests')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              Все результаты <ArrowRight size={12} />
            </button>
          )}
        </CardHeader>
        {recentTests.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-gray-400 gap-2">
            <BookOpen size={28} className="opacity-30" />
            <p className="text-sm">Пока никто не проходил тесты</p>
            <button
              onClick={() => navigate('/tests')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5 mt-2"
            >
              В банк тестов <ArrowRight size={12} />
            </button>
          </div>
        ) : (
          <div className="space-y-0">
            {recentTests.slice(0, 5).map(result => (
              <div key={result.attemptId} className="flex items-center justify-between py-3 px-3 border-b border-slate-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {result.studentName} · {result.testTitle}
                  </div>
                  <div className="text-xs text-gray-400">
                    {result.completedAt ? formatDate(result.completedAt) : '—'}
                  </div>
                </div>
                {result.totalPoints !== null && result.maxPoints !== null && (
                  <div className="ml-3 text-sm font-medium text-gray-600 shrink-0">
                    {result.totalPoints}/{result.maxPoints}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Button
          variant="secondary"
          onClick={() => navigate('/course-program')}
          className="justify-start"
        >
          Программа курса
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate('/catalog')}
          className="justify-start"
        >
          Каталог
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate('/tests')}
          className="justify-start"
        >
          Банк тестов
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate('/homework-queue')}
          className="justify-start"
        >
          Проверка ДЗ
        </Button>
      </div>

    </div>
  )
}
