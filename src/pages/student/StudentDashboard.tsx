import { useCallback, useMemo } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentTodo } from '@/hooks/useStudentTodo'
import { useStudentHomeActivity } from '@/hooks/useStudentHomeActivity'
import { useStudentTopicJournal } from '@/hooks/useStudentTopicJournal'
import { StudentWeekPlan } from '@/components/student/StudentWeekPlan'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { HomeActions } from '@/components/student/home/HomeActions'
import { StreakPill } from '@/components/student/home/StreakPill'
import { StreakCard } from '@/components/student/home/StreakCard'
import { WeeklySolvedCard } from '@/components/student/home/WeeklySolvedCard'
import { MyCoursesCard } from '@/components/student/home/MyCoursesCard'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { useExamForecast } from '@/hooks/useExamForecast'
import { useSchoolPoints } from '@/hooks/useSchoolPoints'
import { ExamForecastCard } from '@/components/student/home/ExamForecastCard'
import { SchoolPointsCard } from '@/components/student/home/SchoolPointsCard'
import { ExamCountdownPill } from '@/components/student/home/ExamCountdownPill'
import { courseCards } from '@/lib/studentHome'
import { examCountdown } from '@/lib/examCountdown'
import { bestMonthDelta, forecastChange } from '@/lib/egeForecast'
import { EGE_SUBJECT_ORDER } from '@/lib/egeScales'
import { useHomeCatalog } from '@/hooks/useHomeCatalog'
import { DailyTaskCard } from '@/components/student/home/DailyTaskCard'
import { WeeklyGoalCard } from '@/components/student/home/WeeklyGoalCard'
import type { CheckOutcome } from '@/hooks/useCatalogPractice'

/**
 * Главная ученика (§254, макет владельца 02.10).
 *
 * Сверху — шапка с серией и кнопки-счётчики «что сдать» (ведут на страницу
 * ДЗ нужным списком); ниже сетка в две колонки: слева «Решено задач по
 * неделям», справа «Серия»; внизу «Эта неделя» по плану (§151) и «Мои курсы».
 *
 * §255: в левой колонке ПЕРВОЙ — «Примерный балл на ЕГЭ» (только у учеников
 * курса ЕГЭ по профильной математике или физике), в правой ПОД «Серией» —
 * «Баллы школы»; в шапке слева от серии — «N дней до ЕГЭ». Растягивается
 * последняя карточка колонки (`flex-1`) — колонки ровные.
 *
 * §256: в левой колонке над прогнозом — «Задача дня» (золотая рамка, ответ
 * вводится здесь) и «Цель недели»; в карточке прогноза — «Решите в каталоге —
 * и балл вырастет». Предмет задачи дня — первый ЕГЭ-предмет ученика
 * (математика раньше физики). После засчитанного ответа перечитываются
 * прогноз (он же даёт «+1 к прогнозу» моделью до/после), баллы и серия.
 */
export function StudentDashboard() {
  const profile = useAuthStore(s => s.profile)
  const dashboard = useStudentDashboard(profile?.id)
  const { todo, loading: todoLoading, error: todoError } = useStudentTodo(profile?.id)
  const home = useStudentHomeActivity(profile?.id)
  const { journal } = useStudentTopicJournal(dashboard.studentId)
  // Подстраховка от «белого экрана»: неполный ответ хука — пустой список, а не TypeError.
  const courses = useMemo(() => dashboard.courses ?? [], [dashboard.courses])
  // §224.2. Идущий пробник — первым на первом экране после входа.
  const mocksByGroup = useMyMockExams(courses.map(c => c.groupId))
  // §255. Прогноз — только если есть курс ЕГЭ по профильной математике или
  // физике (у ОГЭ и прочих карточки нет вовсе, даже скелета).
  const hasEgeForecast = courses.some(c => c.examType === 'ege' && (c.subject === 'math' || c.subject === 'physics'))
  const forecast = useExamForecast(hasEgeForecast ? profile?.id : null)
  const schoolPoints = useSchoolPoints(profile?.id)
  const forecastDelta = useMemo(() => bestMonthDelta(forecast.data), [forecast.data])
  // §256. Задача дня и цель недели — по первому ЕГЭ-предмету ученика.
  const daySubject = EGE_SUBJECT_ORDER.find(sub => courses.some(c => c.examType === 'ege' && c.subject === sub)) ?? null
  const homeCatalog = useHomeCatalog(profile?.id ? daySubject : null)
  const { check: checkDaily, reload: reloadCatalog } = homeCatalog
  const { refresh: refreshForecast, data: forecastData } = forecast
  const { retry: retryPoints } = schoolPoints
  const { retry: retryHome } = home
  const dailyTaskId = homeCatalog.daily?.task?.id ?? null
  const onDailyCheck = useCallback(async (answer: string): Promise<CheckOutcome> => {
    if (!dailyTaskId) return { result: null, change: null, error: 'Задача не найдена' }
    const { result, error } = await checkDaily(dailyTaskId, answer)
    if (!result) return { result: null, change: null, error }
    let change = null
    if (!result.alreadySolved && !result.revealedBefore && result.subject) {
      const after = await refreshForecast()
      change = forecastChange(forecastData, after, result.subject)
    }
    if (result.counted) { retryPoints(); retryHome(); reloadCatalog() }
    return { result, change, error: null }
  }, [dailyTaskId, checkDaily, refreshForecast, forecastData, retryPoints, retryHome, reloadCatalog])
  const countdown = examCountdown(home.activity?.today, courses.map(c => c.examType))

  const cards = useMemo(() => courseCards(
    courses.map(c => ({ courseId: c.courseId, groupId: c.groupId, title: c.courseTitle, subject: c.subject })),
    home.activity?.courses ?? null,
    journal?.homework ?? [],
  ), [courses, home.activity, journal])

  if (dashboard.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-[1120px] gap-3.5" data-testid="student-home">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-extrabold tracking-tight text-graphite-950 sm:text-[1.55rem]">
            Привет, {profile?.full_name?.split(' ')[1] || 'Ученик'}
          </h1>
          <p className="text-[15px] text-graphite-500">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {(countdown || home.activity) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {countdown && <ExamCountdownPill countdown={countdown} />}
            {home.activity && <StreakPill activity={home.activity} />}
          </div>
        )}
      </header>

      {/* §224.2. Идущий / ближайший пробник — над кнопками: это главное
          действие дня, пока окно открыто. Подпись курса — курсов бывает два. */}
      {courses.map(c => (
        <MockExamAlert key={c.groupId} exams={mocksByGroup[c.groupId] ?? []} groupId={c.groupId} context={c.courseTitle} />
      ))}

      <HomeActions todo={todo} loading={todoLoading} error={todoError} />

      <div className="grid grid-cols-1 gap-3.5 min-[900px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5" data-slot="left">
          {homeCatalog.daily?.task && (
            <DailyTaskCard
              daily={homeCatalog.daily}
              streak={home.activity?.streakDays != null ? home.activity.streak : null}
              solvedToday={home.activity?.solvedToday === true}
              onCheck={onDailyCheck}
            />
          )}
          {homeCatalog.weekly && <WeeklyGoalCard goal={homeCatalog.weekly} />}
          {hasEgeForecast && (
            <ExamForecastCard data={forecast.data} error={forecast.error} onRetry={forecast.retry} onSetGoal={forecast.setGoal} />
          )}
          <WeeklySolvedCard activity={home.activity} error={home.error} onRetry={home.retry} className="flex-1" />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5" data-slot="right">
          <StreakCard activity={home.activity} error={home.error} onRetry={home.retry} />
          <SchoolPointsCard points={schoolPoints.points} error={schoolPoints.error} onRetry={schoolPoints.retry} forecastDelta={forecastDelta} className="flex-1" />
        </div>
      </div>

      {/* Эта неделя по учебному плану (§151); без плана не рисуется. Стоит у
          курсов: кнопки сверху уже отвечают «что сдать», план — взгляд на
          неделю курса. */}
      <StudentWeekPlan />

      <MyCoursesCard cards={cards} />
    </div>
  )
}
