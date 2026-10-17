import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { useStudentActivity } from '@/hooks/useStudentActivity'
import { CourseProgressCard } from '@/components/student/home/CourseProgressCard'
import { examCountdown } from '@/lib/examCountdown'
import { mskDateKey } from '@/lib/homeworkDeadline'
import { continueHref, primaryContinue } from '@/lib/studentHomeCourses'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { SubscriptionPathCard } from '@/components/student/home/SubscriptionPathCard'
import { DiagnosticHomeCard } from '@/components/student/home/DiagnosticHomeCard'
import { GoalsCard } from '@/components/student/home/GoalsCard'
import { CourseChip, HomeCoverBlock, HomeTitle, type HomeProp } from '@/components/student/home/HomeNotionHead'
import { ClockWidget, ExamWidget, MonthWidget } from '@/components/student/home/HomeWidgets'
import { HomeToday, type TodayItem } from '@/components/student/home/HomeToday'
import { HomeContinue } from '@/components/student/home/HomeContinue'
import { TelegramOnboarding } from '@/components/shared/TelegramOnboarding'
import { EXAM_DAYS, examWidget } from '@/lib/examDates'
import { activityDaysFor, streakValue } from '@/lib/homeNotion'
import { fetchMyExamGoals, fetchMyWeeklyGoals, goalBasis, type ExamGoal, type WeeklyGoal } from '@/lib/studentGoals'
import { useMySubscriptionsLite } from '@/hooks/useMySubscriptionsLite'
import { subscriptionTag } from '@/lib/studentNav'
import { useMyTopicHomework } from '@/hooks/useMyTopicHomework'
import { useMyForecastRanges } from '@/hooks/useMyForecastRanges'
import { ForecastCard } from '@/components/student/ForecastCard'
import { fetchMyScoreForecast, forecastHint, forecastNote, type StoredForecast } from '@/lib/scoreForecast'

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
 *  5. «Цели недели» и «Сегодня» (ДЗ к сдаче, следующий урок) — списками с
 *     галочками; «Продолжить» — три урока с тем же статусом и замком, что в
 *     плитках курса;
 *  6. «Мои курсы».
 *
 * Данные и подсчёты — прежние источники; новых RPC нет. Добавились чтения,
 * которые уже делают соседние экраны: «Мои подписки» (как метка в меню),
 * журнал ДЗ (как счётчик «ДЗ» в меню) и программа главного курса (как
 * страница курса) — для «Сегодня» и «Продолжить».
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
  const items = useMemo(() => {
    const byId = new Map(progress.map(p => [p.courseId, p]))
    return courses.map(c => ({
      courseId: c.courseId, groupId: c.groupId, title: c.courseTitle, subject: c.subject,
      progress: byId.get(c.courseId) ?? null,
    }))
  }, [courses, progress])

  // Календарь месяца листает до 3 месяцев назад — история с 1-го числа.
  const activity = useStudentActivity(!!profile?.id, todayMsk, activityDaysFor(todayMsk))

  // Цели: на экзамен — в строке свойств, недели — списком. Читаются один раз.
  // Прогноз балла — хранимый (forecast-daily, письмо 16.10): простой select, без пересчёта в браузере.
  const [goals, setGoals] = useState<{ exam: ExamGoal[]; weekly: WeeklyGoal[]; forecast: StoredForecast[] | null } | null>(null)
  const hasCourses = courses.length > 0
  useEffect(() => {
    if (!profile?.id || !hasCourses) return
    let alive = true
    Promise.all([fetchMyExamGoals(profile.id), fetchMyWeeklyGoals(), fetchMyScoreForecast()])
      .then(([exam, w, forecast]) => { if (alive) setGoals({ exam, weekly: w.data?.goals ?? [], forecast }) })
      .catch(() => { if (alive) setGoals({ exam: [], weekly: [], forecast: null }) })
    return () => { alive = false }
  }, [profile?.id, hasCourses])

  // Виджет «Прогноз ЕГЭ» (письмо 17.10): предметы ЕГЭ ученика — физика и/или математика.
  const forecastSubjects = useMemo(
    () => [...new Set(courses.filter(c => c.examType === 'ege').map(c => c.subject ?? ''))].filter(s => s === 'physics' || s === 'math'),
    [courses],
  )
  const ranges = useMyForecastRanges(forecastSubjects.length > 0)

  const mySubs = useMySubscriptionsLite(subscriptionsOn.enabled)
  const hw = useMyTopicHomework(null)
  const { buckets, topicLink } = hw

  const today = useMemo<TodayItem[]>(() => {
    const out: TodayItem[] = buckets.todo.slice(0, 3).map(r => ({
      key: `hw-${r.homework_id}`,
      text: `Сдать ДЗ «${r.topic_title}»`,
      to: topicLink(r),
      pill: r.is_overdue ? 'просрочено' : 'ДЗ',
      tone: r.is_overdue ? 'bad' : 'hw',
    }))
    if (next && !buckets.todo.some(r => r.topic_id === next.next.topicId)) {
      out.push({
        key: `lesson-${next.next.topicId}`, text: `Урок «${next.next.title}»`,
        to: continueHref(next.course.groupId, next.next), pill: 'урок', tone: 'lesson',
      })
    }
    return out
  }, [buckets.todo, topicLink, next])

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
      const it = items.find(i => i.subject === g.subject)
      return it?.progress ? goalBasis(null, { done: it.progress.done, total: it.progress.total }) : null
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

      <div className={forecastSubjects.length > 0 && activity ? 'stu-widgets has-fc' : 'stu-widgets'} data-testid="home-widgets">
        <ExamWidget data={examData} fallback={examData ? null : countdown} />
        <ClockWidget today={todayMsk} />
        {activity && <MonthWidget grid={activity} today={todayMsk} />}
        {forecastSubjects.length > 0 && (
          <section className="stu-card stu-w stu-w-fc" data-testid="home-w-forecast">
            {forecastSubjects.map(sub => (
              <ForecastCard key={sub} subject={sub} range={ranges?.find(r => r.subject === sub)} loading={ranges == null} />
            ))}
          </section>
        )}
      </div>

      {hasCourses && (
        <div className="stu-ntwo">
          {goals && <GoalsCard weekly={goals.weekly} />}
          <HomeToday items={today} loading={hw.loading} />
        </div>
      )}

      {next && (
        <HomeContinue groupId={next.course.groupId} courseId={next.course.courseId} courseTitle={next.course.courseTitle} nextTopicId={next.next.topicId} />
      )}

      <CourseProgressCard items={items} mainCourseId={next?.course.courseId ?? null} />
    </div>
  )
}
