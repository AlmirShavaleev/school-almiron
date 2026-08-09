import { useNavigate } from 'react-router-dom'
import { BookOpen, Target, AlertCircle, ArrowRight } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentTodo } from '@/hooks/useStudentTodo'
import { StudentTodoList } from '@/components/student/StudentTodoList'
import { formatDate } from '@/utils/format'
import { cn } from '@/utils/cn'
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_TONE, gradeScaleMax } from '@/lib/topicHomework'
import { formatScore, scorePercent } from '@/lib/topicTest'

export function StudentDashboard() {
  const profile = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const dashboard = useStudentDashboard(profile?.id)
  // Список дел — первый экран: ученик заходит с вопросом «что мне сдать»,
  // а не «сколько у меня курсов». Плитки и курсы остаются ниже.
  const { todo, loading: todoLoading, error: todoError } = useStudentTodo(profile?.id)
  const { loading } = dashboard
  // Подстраховка от «белого экрана»: если хук по любой причине вернул неполный
  // набор (ошибка запроса, обрезанный ответ), страница должна показать нули,
  // а не рухнуть на `stats.hwRevision` с TypeError. Кабинет — первый экран
  // после входа, падать ему нельзя.
  const courses = dashboard.courses ?? []
  const hwItems = dashboard.hwItems ?? []
  const testItems = dashboard.testItems ?? []
  const stats = dashboard.stats ?? {
    courses: 0, hwTotal: 0, hwAccepted: 0, hwWaiting: 0, hwRevision: 0,
    testsAvailable: 0, testsCompleted: 0,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hasRevisions = stats.hwRevision > 0
  const checkedAndWaiting = stats.hwWaiting + stats.hwRevision

  return (
    <div className="space-y-7">
      {/* Hero */}
      <div className="platform-surface rounded-lg p-5 sm:p-6">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
            <Target size={13} />
            Личный маршрут
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-graphite-950 break-words">
            Привет, {profile?.full_name?.split(' ')[1] || 'Ученик'}
          </h1>
          <p className="text-slate-500 mt-1">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {/* Что сдать — до плиток и курсов */}
      <StudentTodoList todo={todo} loading={todoLoading} error={todoError} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Мои курсы"
          value={stats.courses}
          icon={<BookOpen size={20} />}
          color="blue"
          subtitle={stats.courses === 1 ? 'курс' : 'курсов'}
        />
        <StatCard
          title="ДЗ принято"
          value={`${stats.hwAccepted}/${stats.hwTotal}`}
          icon={<BookOpen size={20} />}
          color={stats.hwAccepted === stats.hwTotal && stats.hwTotal > 0 ? 'green' : 'blue'}
          subtitle="выполнено"
        />
        <StatCard
          title="На проверке/доработке"
          value={checkedAndWaiting}
          icon={<AlertCircle size={20} />}
          color={checkedAndWaiting > 0 ? 'orange' : 'green'}
          subtitle={checkedAndWaiting > 0 ? 'ожидают действия' : 'всё чисто'}
        />
        <StatCard
          title="Тесты"
          value={`${stats.testsCompleted}/${stats.testsAvailable}`}
          icon={<Target size={20} />}
          color={stats.testsCompleted === stats.testsAvailable && stats.testsAvailable > 0 ? 'green' : 'purple'}
          subtitle="пройдено"
        />
      </div>

      {/* Revision banner */}
      {hasRevisions && (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-amber-900">
              У вас {stats.hwRevision} {stats.hwRevision === 1 ? 'работа' : stats.hwRevision % 10 === 1 && stats.hwRevision % 100 !== 11 ? 'работа' : 'работ'} на доработке
            </div>
          </div>
          <button
            onClick={() => navigate('/my-course')}
            className="w-full sm:w-auto min-h-11 shrink-0 flex items-center justify-center px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 transition-colors"
          >
            К курсу
          </button>
        </div>
      )}

      {/* Courses section */}
      {courses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Мои курсы</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {courses.map(course => (
              <div
                key={course.courseId}
                onClick={() => navigate(`/my-course/${course.groupId}`)}
                className="flex flex-col justify-between p-4 rounded-xl border border-gray-100 bg-gray-50 hover:border-primary-200 hover:bg-primary-50/40 transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-gray-900">{course.courseTitle}</div>
                  {course.subject && (
                    <div className="text-xs text-gray-500 mt-1">{course.subject}</div>
                  )}
                </div>
                <div className="text-xs text-primary-600 font-medium mt-3 flex items-center gap-1">
                  Открыть <ArrowRight size={12} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent HW section */}
      <Card>
        <CardHeader>
          <CardTitle>Последние ДЗ</CardTitle>
        </CardHeader>
        {hwItems.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">Домашних заданий пока нет</p>
        ) : (
          <div className="space-y-2">
            {hwItems.map(hw => {
              const statusLabel = ATTEMPT_STATUS_LABEL[hw.status]
              const statusTone = ATTEMPT_STATUS_TONE[hw.status]
              const maxScore = hw.gradeScale ? gradeScaleMax(hw.gradeScale) : null
              const scoreDisplay = hw.status === 'accepted' && hw.score != null && maxScore ? `${hw.score}/${maxScore}` : null

              return (
                <div
                  key={hw.attemptId}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{hw.hwTitle}</div>
                    {hw.updatedAt && (
                      <div className="text-xs text-gray-400 mt-0.5">{formatDate(hw.updatedAt)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    {scoreDisplay && (
                      <span className="text-xs font-medium text-gray-600">{scoreDisplay}</span>
                    )}
                    <span className={cn('text-xs font-medium px-2 py-1 rounded-full', statusTone)}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Recent tests section */}
      <Card>
        <CardHeader>
          <CardTitle>Мои тесты</CardTitle>
        </CardHeader>
        {testItems.length === 0 ? (
          <p className="text-gray-400 text-sm py-4 text-center">Пройденных тестов пока нет</p>
        ) : (
          <div className="space-y-2">
            {testItems.map(test => {
              const percent = scorePercent(test.totalPoints, test.maxPoints)

              return (
                <div
                  key={test.attemptId}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{test.testTitle}</div>
                    {test.completedAt && (
                      <div className="text-xs text-gray-400 mt-0.5">{formatDate(test.completedAt)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-3 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-medium text-gray-600">{formatScore(test.totalPoints, test.maxPoints)}</div>
                      {percent != null && (
                        <div className="text-xs text-gray-400">{percent}%</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
