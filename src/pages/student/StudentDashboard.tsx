import { useNavigate } from 'react-router-dom'
import { Calendar, BookOpen, TrendingUp, Target, Clock, CheckCircle, AlertCircle, ArrowRight, CreditCard, RefreshCw } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useSubscription } from '@/hooks/useSubscription'
import { useStudentCourses } from '@/hooks/useStudentCourses'
import { CourseSelector } from '@/components/CourseSelector'
import { formatDate, formatDateTime, HW_STATUS_LABELS, HW_STATUS_COLORS } from '@/utils/format'
import { cn } from '@/utils/cn'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function isToday(iso: string) {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

function isOverdue(iso: string) {
  return new Date(iso) < new Date()
}

export function StudentDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const { student, nextLesson, homeworks, mockResults, recommendations, attendanceRate, loading } =
    useStudentDashboard(profile?.id)
  const { subscription, loading: subLoading } = useSubscription()
  const studentCourses = useStudentCourses(student?.id)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!student) {
    return (
      <div className="text-center py-16 text-gray-500">
        Профиль ученика не найден. Обратитесь к администратору.
      </div>
    )
  }

  const allHW     = homeworks
  const pendingHW = allHW.filter((h: any) => {
    const s = h.homework_submissions?.[0]?.status
    return !s || s === 'not_submitted'
  })
  const urgentHW = pendingHW
    .filter((h: any) => isOverdue(h.due_date) || (new Date(h.due_date).getTime() - Date.now() < 3 * 86400_000))
    .slice(0, 3)

  const checkedHW = allHW.filter((h: any) => h.homework_submissions?.[0]?.status === 'checked' && h.homework_submissions[0].score != null)
  const hwAvgScore = checkedHW.length > 0
    ? Math.round(checkedHW.reduce((acc: number, h: any) => acc + h.homework_submissions[0].score / h.max_score * 100, 0) / checkedHW.length)
    : null

  const lastMock = mockResults[0]
  const progressData = mockResults
    .slice().reverse()
    .map((r: any) => ({
      label: formatDate(r.mock_exams?.date),
      score: r.score,
    }))
    .slice(-6)

  const lessonIsToday = nextLesson && isToday(nextLesson.scheduled_at)

  return (
    <div className="space-y-7">

      {/* Hero */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Привет, {profile?.full_name?.split(' ')[1] || 'Ученик'}! 👋
        </h1>
        <p className="text-gray-500 mt-1">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Course selector */}
      {studentCourses.courses.length > 0 && (
        <CourseSelector
          courses={studentCourses.courses}
          activeId={studentCourses.activeCourseId}
          onSelect={studentCourses.setActive}
        />
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="ДЗ на сдачу"
          value={pendingHW.length}
          icon={<BookOpen size={20} />}
          color={pendingHW.length > 0 ? 'orange' : 'green'}
          subtitle={pendingHW.length === 0 ? 'Всё сдано 🎉' : 'Ожидают выполнения'}
        />
        <StatCard
          title="Посещаемость"
          value={attendanceRate > 0 ? `${attendanceRate}%` : '—'}
          icon={<CheckCircle size={20} />}
          color={attendanceRate >= 80 ? 'green' : attendanceRate >= 60 ? 'orange' : 'red'}
          subtitle="За всё время"
        />
        <StatCard
          title="Средний балл ДЗ"
          value={hwAvgScore != null ? `${hwAvgScore}%` : '—'}
          icon={<TrendingUp size={20} />}
          color={hwAvgScore != null && hwAvgScore >= 80 ? 'green' : hwAvgScore != null && hwAvgScore >= 60 ? 'orange' : 'purple'}
          subtitle={checkedHW.length > 0 ? `${checkedHW.length} проверено` : 'Нет проверенных'}
        />
        <StatCard
          title="Цель"
          value={student.target_score ? `${student.target_score} б.` : '—'}
          icon={<Target size={20} />}
          color="blue"
          subtitle={student.target_exam?.toUpperCase() || 'Не задана'}
        />
      </div>

      {/* Today lesson alert */}
      {lessonIsToday && (
        <div className="flex items-center gap-4 p-4 bg-primary-50 border border-primary-200 rounded-2xl">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center shrink-0">
            <Calendar size={20} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-primary-900">Сегодня занятие!</div>
            <div className="text-sm text-primary-700">{nextLesson.title} · {formatDateTime(nextLesson.scheduled_at)}</div>
          </div>
          {nextLesson.zoom_link && (
            <a
              href={nextLesson.zoom_link}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
            >
              Подключиться →
            </a>
          )}
        </div>
      )}

      {/* Main 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Ближайшее занятие */}
        <Card>
          <CardHeader>
            <CardTitle>Ближайшее занятие</CardTitle>
            <Calendar size={16} className="text-gray-400" />
          </CardHeader>
          {nextLesson ? (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <div className="font-semibold text-gray-900">{nextLesson.title}</div>
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Clock size={13} />
                {formatDateTime(nextLesson.scheduled_at)}
                <span className="text-gray-300">·</span>
                {nextLesson.duration_minutes} мин.
              </div>
              {nextLesson.zoom_link && !lessonIsToday && (
                <a href={nextLesson.zoom_link} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium mt-1">
                  🎥 Ссылка на занятие
                </a>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm py-4 text-center">Занятий не запланировано</p>
          )}
        </Card>

        {/* Домашние задания */}
        <Card>
          <CardHeader>
            <CardTitle>Домашние задания</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={pendingHW.length > 0 ? 'warning' : 'success'}>
                {pendingHW.length} не сдано
              </Badge>
              <button
                onClick={() => navigate('/homeworks')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
              >
                Все <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>
          {allHW.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Домашних заданий нет</p>
          ) : (
            <div className="space-y-2">
              {allHW.slice(0, 5).map((hw: any) => {
                const sub    = hw.homework_submissions?.[0]
                const status = sub?.status || 'not_submitted'
                const over   = isOverdue(hw.due_date) && status === 'not_submitted'
                return (
                  <div key={hw.id} className={cn(
                    'flex items-center justify-between py-2.5 px-3 rounded-xl border transition-colors',
                    over ? 'border-red-200 bg-red-50' : 'border-gray-100 hover:border-gray-200'
                  )}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{hw.title}</div>
                      <div className={cn('text-xs mt-0.5', over ? 'text-red-500 font-medium' : 'text-gray-400')}>
                        {over ? '🔴 Просрочено · ' : 'до '}
                        {formatDate(hw.due_date)}
                      </div>
                    </div>
                    <span className={cn('text-xs font-medium px-2 py-1 rounded-full ml-3 shrink-0', HW_STATUS_COLORS[status])}>
                      {HW_STATUS_LABELS[status]}
                      {sub?.score != null && ` · ${sub.score}/${hw.max_score}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Прогресс пробников */}
        <Card>
          <CardHeader>
            <CardTitle>Прогресс по пробникам</CardTitle>
            <TrendingUp size={16} className="text-green-500" />
          </CardHeader>
          {progressData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={progressData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v} б.`, 'Балл']} />
                <Area type="monotone" dataKey="score" stroke="#3b82f6" fill="url(#scoreGrad)" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : lastMock ? (
            <div className="flex items-center gap-5 py-3">
              <div className="w-16 h-16 relative shrink-0">
                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#e5e7eb" strokeWidth="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#3b82f6" strokeWidth="3"
                    strokeDasharray={`${Math.round(lastMock.score / (lastMock.mock_exams?.max_score || 100) * 100)}, 100`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
                  {Math.round(lastMock.score / (lastMock.mock_exams?.max_score || 100) * 100)}%
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary-600">{lastMock.score} б.</div>
                <div className="text-xs text-gray-400">{lastMock.mock_exams?.title}</div>
                <div className="text-xs text-gray-400">{formatDate(lastMock.mock_exams?.date)}</div>
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm py-8 text-center">Пробников пока нет</p>
          )}
        </Card>

        {/* Рекомендации преподавателя */}
        {recommendations.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Рекомендации преподавателя</CardTitle>
            </CardHeader>
            <div className="space-y-2.5">
              {recommendations.slice(0, 3).map((rec: any) => (
                <div key={rec.id} className="flex gap-3 p-3 bg-blue-50 rounded-xl">
                  <div className="w-1.5 h-full min-h-[16px] rounded-full bg-primary-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm text-gray-700">{rec.text}</div>
                    {rec.profiles?.full_name && (
                      <div className="text-xs text-gray-400 mt-1">— {rec.profiles.full_name}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col items-center justify-center py-10 text-center">
            <TrendingUp size={32} className="text-gray-200 mb-3" />
            <div className="text-sm font-medium text-gray-500">Хорошая работа!</div>
            <div className="text-xs text-gray-400 mt-1">Рекомендации преподавателя появятся здесь</div>
            <button
              onClick={() => navigate('/my-progress')}
              className="mt-4 text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              Посмотреть прогресс <ArrowRight size={12} />
            </button>
          </Card>
        )}
      </div>

      {/* Subscription widget */}
      {!subLoading && (
        subscription ? (
          <div
            onClick={() => navigate('/payments')}
            className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary-50 to-purple-50 border border-primary-200 rounded-2xl cursor-pointer hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
              <CreditCard size={18} className="text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-primary-900">{subscription.plans?.name || 'Подписка'}</span>
                <span className={cn(
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  subscription.status === 'active'   ? 'bg-green-100 text-green-700' :
                  subscription.status === 'trial'    ? 'bg-blue-100 text-blue-700' :
                  subscription.status === 'past_due' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                )}>
                  {subscription.status === 'active'   ? 'Активна' :
                   subscription.status === 'trial'    ? 'Пробная' :
                   subscription.status === 'past_due' ? 'Просрочена' : subscription.status}
                </span>
                {subscription.cancel_at_period_end && (
                  <span className="text-xs text-orange-500 font-medium">— отменяется</span>
                )}
              </div>
              {subscription.current_period_end && (
                <div className="text-xs text-primary-600 mt-0.5 flex items-center gap-1">
                  <RefreshCw size={11} />
                  {subscription.cancel_at_period_end ? 'Истекает' : 'Следующий платёж'}
                  {' '}{new Date(subscription.current_period_end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                </div>
              )}
            </div>
            <ArrowRight size={16} className="text-primary-400 shrink-0" />
          </div>
        ) : (
          <div
            onClick={() => navigate('/pricing')}
            className="flex items-center gap-4 p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl cursor-pointer hover:border-primary-300 hover:bg-primary-50 transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-primary-100 flex items-center justify-center shrink-0 transition-colors">
              <CreditCard size={18} className="text-gray-400 group-hover:text-primary-600 transition-colors" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-700 group-hover:text-primary-900 transition-colors">Нет активной подписки</div>
              <div className="text-xs text-gray-400 group-hover:text-primary-600 transition-colors">Выбрать тариф и начать учиться →</div>
            </div>
            <ArrowRight size={16} className="text-gray-300 group-hover:text-primary-400 shrink-0 transition-colors" />
          </div>
        )
      )}

      {/* Urgent HW alert */}
      {urgentHW.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-orange-500" />
              <CardTitle className="text-orange-800">Срочно сдать!</CardTitle>
            </div>
          </CardHeader>
          <div className="space-y-2">
            {urgentHW.map((hw: any) => (
              <div key={hw.id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-orange-900">{hw.title}</span>
                <span className="text-xs text-orange-600">до {formatDate(hw.due_date)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
