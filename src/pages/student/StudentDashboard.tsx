import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { useStudentActivity } from '@/hooks/useStudentActivity'
import { StudentWorkPlanHome } from '@/components/workPlans/StudentWorkPlan'
import { examCountdown } from '@/lib/examCountdown'
import { mskDateKey } from '@/lib/homeworkDeadline'
import { continueHref, primaryContinue } from '@/lib/studentHomeCourses'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { SubscriptionPathCard } from '@/components/student/home/SubscriptionPathCard'
import { DiagnosticHomeCard } from '@/components/student/home/DiagnosticHomeCard'
import { CourseChip, HomeCoverBlock, HomeTitle, type HomeProp } from '@/components/student/home/HomeNotionHead'
import { ClockWidget, ExamWidget, MonthWidget } from '@/components/student/home/HomeWidgets'
import { TelegramOnboarding } from '@/components/shared/TelegramOnboarding'
import { EXAM_DAYS, examWidget } from '@/lib/examDates'
import { activityDaysFor, streakValue } from '@/lib/homeNotion'
import { fetchMyExamGoals, goalBasis, type ExamGoal } from '@/lib/studentGoals'
import { useMySubscriptionsLite } from '@/hooks/useMySubscriptionsLite'
import { subscriptionTag } from '@/lib/studentNav'
import { useMyForecastRanges } from '@/hooks/useMyForecastRanges'
import { ForecastCard } from '@/components/student/ForecastCard'
import { fetchMyScoreForecast, forecastHint, forecastNote, type StoredForecast } from '@/lib/scoreForecast'

/**
 * ВРЕМЕННО, инцидент 18.11.2026: production не загружает тяжёлую
 * статистику главной (календарь активности / прогноз баллов), пока
 * восстанавливаем производительность базы. В dev/test виджеты остаются.
 * Откат: заменить false на true для production.
 */
const ENABLE_HEAVY_STUDENT_HOME_STATS = !import.meta.env.PROD

/**
 * Главная ученика «как в Notion» в стиле лендинга (письмо
 * ЛК_стиль_главная_как_notion.md, 16.10; до того — «без шума», 13.10, и стиль
 * лендинга, 14.10). Сверху вниз:
 *
 *  1. обложка (набор из пяти, выбор — в localStorage) и аватар поверх неё;
 *  2. «Имя · подготовка к ЕГЭ», строка свойств (цель, курс, подписка «до …»,
 *     серия) и под ней строкой — приглашение привязать Telegram;
 *  3. идущий пробник (MockExamAlert), плашка пробного/доступа и диагностика —
 *     как раньше;
 *  4. три виджета: «До ЕГЭ» (даты — src/lib/examDates.ts), часы с фразой дня,
 *     мини-календарь месяца посещений (та же `student_home_activity`);
 *  5. «Мой план работы».
 *
 * Недельные цели и список «Сегодня» отключены: главная не загружает
 * недельный прогресс и журнал ДЗ для этих блоков.
 */
export function StudentDashboard() {
  const profile = useAuthStore(s => s.profile)
  const subscriptionsOn = useSubscriptionsEnabled()
  const path = useStudentPathHome(profile?.id, subscriptionsOn.enabled)
  const dashboard = useStudentDashboard(profile?.id)
  // Подстраховка от «белого экрана»: неполный ответ хука — пустой список, а не TypeError.
  const courses = useMemo(() => dashboard.courses ?? [], [dashboard.courses])
  const mocksByGroup = useMyMockExams(courses.map(c => c.groupId))
  const homeCourses = useStudentHomeCourses(profile?.id)
  // День по Москве — один на заход на главную (полночь в открытой вкладке не ловим).
  const [todayMsk] = useState(() => mskDateKey(Date.now()))
  const countdown = examCountdown(todayMsk, courses.map(c => c.examType))
  const examData = useMemo(
    () => examWidget(todayMsk, courses.filter(c => c.examType === 'ege').map(c => c.subject ?? '')),
    [todayMsk, courses],
  )

  const progress = useMemo(() => homeCourses.courses ?? [], [homeCourses.courses])
  const next = useMemo(() => primaryContinue(courses, progress), [courses, progress])

  // Календарь месяца листает до 3 месяцев назад — история с 1-го числа.
  const activity = useStudentActivity(ENABLE_HEAVY_STUDENT_HOME_STATS && !!profile?.id, todayMsk, activityDaysFor(todayMsk))

  // Цель на экзамен — в строке свойств. Читается один раз.
  // Прогноз балла — хранимый (forecast-daily, письмо 16.10): простой select, без пересчёта в браузере.
  const [goals, setGoals] = useState<{ exam: ExamGoal[]; forecast: StoredForecast[] | null } | null>(null)
  const hasCourses = courses.length > 0
  useEffect(() => {
    if (!profile?.id || !hasCourses) return
    let alive = true
    Promise.all([fetchMyExamGoals(profile.id), ENABLE_HEAVY_STUDENT_HOME_STATS ? fetchMyScoreForecast() : Promise.resolve(null)])
      .then(([exam, forecast]) => { if (alive) setGoals({ exam, forecast }) })
      .catch(() => { if (alive) setGoals({ exam: [], forecast: null }) })
    return () => { alive = false }
  }, [profile?.id, hasCourses])

  // Виджет «Прогноз ЕГЭ» (письмо 17.10): предметы ЕГЭ ученика — физика и/или математика.
  const forecastSubjects = useMemo(
    () => [...new Set(courses.filter(c => c.examType === 'ege').map(c => c.subject ?? ''))].filter(s => s === 'physics' || s === 'math'),
    [courses],
  )
  // Goal caption and forecast widget share the same stored-forecast result.
  // Wait for the noncritical goals batch instead of firing a duplicate RPC
  // during the initial student-home request burst.
  const ranges = useMyForecastRanges(ENABLE_HEAVY_STUDENT_HOME_STATS && forecastSubjects.length > 0 && goals !== null, goals?.forecast)

  const mySubs = useMySubscriptionsLite(subscriptionsOn.enabled)

  if (path.data?.onboarding.needed) return <Navigate to="/start" replace />

  if (dashboard.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[var(--blue)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const words = (profile?.full_name ?? '').split(' ').filter(Boolean)
  const name = words[1] || words[0] || 'Ученик'
  const initials = words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'У'
  const exam = countdown ? (countdown.exam === 'ege' ? 'ЕГЭ' : 'ОГЭ') : null
  const subTag = subscriptionsOn.enabled ? subscriptionTag(mySubs ?? []) : null

  const props: HomeProp[] = []
  if (hasCourses && goals) {
    const basis = goals.exam.map(g => {
      const course = courses.find(c => c.subject === g.subject)
      const courseProgress = progress.find(p => p.courseId === course?.courseId)
      return courseProgress ? goalBasis(null, courseProgress) : null
    }).filter(Boolean).join('; ')
    props.push({
      key: 'goal', icon: 'target', label: 'Цель',
      value: goals.exam.length > 0
        ? goals.exam.map(g => [`${EXAM_DAYS[g.subject].short} ${g.goal}+`, forecastNote(goals.forecast, g.subject)].filter(Boolean).join(' · ')).join(', ')
        : <Link to="/settings?tab=goals" className="stu-link">поставить</Link>,
      title: [basis, ...goals.exam.map(g => forecastHint(goals.forecast, g.subject))].filter(Boolean).join('; ') || undefined,
    })
  }
  if (hasCourses) {
    props.push({
      key: 'course', icon: 'book', label: courses.length > 1 ? 'Курсы' : 'Курс',
      value: <span className="inline-flex flex-wrap gap-1.5">{courses.map(c => <CourseChip key={c.groupId} to={`/my-course/${c.groupId}`} title={c.courseTitle} />)}</span>,
    })
  }
  if (subTag) props.push({ key: 'sub', icon: 'calendar', label: 'Подписка', value: subTag })
  if (activity) props.push({ key: 'streak', icon: 'rocket', label: 'Серия', value: streakValue(activity.streak) })

  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-6 pb-10 sm:gap-8" data-testid="student-home">
      <div className="stu-card stu-nsheet">
        <HomeCoverBlock profileId={profile?.id ?? null} />
        <HomeTitle
          name={name}
          initials={initials}
          avatarUrl={profile?.avatar_url ?? null}
          exam={exam}
          props={props}
          action={next
            ? <Link to={continueHref(next.course.groupId, next.next)} className="stu-btn stu-btn-p" data-testid="hero-continue">Продолжить урок →</Link>
            : !hasCourses && subscriptionsOn.enabled
              ? <Link to="/courses" className="stu-btn stu-btn-p">Выбрать курс →</Link>
              : null}
        >
          <TelegramOnboarding skin compact />
        </HomeTitle>
      </div>

      {/* §224.2. Идущий / ближайший пробник: пока окно открыто, это главное
          действие дня. Подпись курса — курсов бывает два. */}
      {courses.map(c => (
        <MockExamAlert key={c.groupId} exams={mocksByGroup[c.groupId] ?? []} groupId={c.groupId} context={c.courseTitle} />
      ))}

      {/* §290-B: плашка пробного/доступа; §289: «Пройдите диагностику» */}
      {path.data && <SubscriptionPathCard subscriptions={path.data.subscriptions} showContinue={false} />}
      <DiagnosticHomeCard onboarding={path.data?.onboarding} />

      {!hasCourses && (
        <p className="stu-card p-5 text-[15px]" data-testid="home-no-courses">
          {subscriptionsOn.enabled
            ? <>Курсов пока нет. Загляни в <b>«Курсы»</b> — там можно начать с пробного доступа.</>
            : <>Курсов пока нет. Как только преподаватель добавит тебя в группу, курс появится здесь.</>}
        </p>
      )}

      <div className={ENABLE_HEAVY_STUDENT_HOME_STATS && forecastSubjects.length > 0 && activity ? 'stu-widgets has-fc' : 'stu-widgets'} data-testid="home-widgets">
        <ExamWidget data={examData} fallback={examData ? null : countdown} />
        <ClockWidget today={todayMsk} />
        {activity && <MonthWidget grid={activity} today={todayMsk} />}
        {ENABLE_HEAVY_STUDENT_HOME_STATS && forecastSubjects.length > 0 && (
          <section className="stu-card stu-w stu-w-fc" data-testid="home-w-forecast">
            {forecastSubjects.map(sub => (
              <ForecastCard key={sub} subject={sub} range={ranges?.find(r => r.subject === sub)} loading={ranges == null} />
            ))}
          </section>
        )}
      </div>

      <StudentWorkPlanHome data={homeCourses.workPlans} />
    </div>
  )
}
