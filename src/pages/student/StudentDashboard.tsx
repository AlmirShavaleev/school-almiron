import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { ExamCountdownPill } from '@/components/student/home/ExamCountdownPill'
import { ContinueLessonCard } from '@/components/student/home/ContinueLessonCard'
import { CourseProgressCard } from '@/components/student/home/CourseProgressCard'
import { examCountdown } from '@/lib/examCountdown'
import { mskDateKey } from '@/lib/homeworkDeadline'
import { primaryContinue } from '@/lib/studentHomeCourses'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { SubscriptionPathCard } from '@/components/student/home/SubscriptionPathCard'
import { DiagnosticHomeCard } from '@/components/student/home/DiagnosticHomeCard'

/**
 * Главная ученика «без шума» (письмо главная_ученика_без_шума.md, решения
 * владельца 13.10). Только важное и минимум запросов:
 *
 *  1. шапка: «Привет, …», дата и «N дней до ЕГЭ» — считается на клиенте по
 *     московской дате, без запросов (серия убрана);
 *  2. идущий/ближайший пробник (MockExamAlert) — как раньше;
 *  3. «Продолжить урок» — одна заметная карточка: следующая открытая тема с
 *     несданным ДЗ;
 *  4. «Мои курсы» — одна карточка на курс: общий % и полоски по разделам
 *     (доля тем раздела с ДЗ сдано/принято) и «Продолжить».
 *
 * Запросы: курсы ученика (students + group_students), пробники групп и одна
 * RPC `student_home_courses()` на все курсы. Ушли «что сдать», задача дня,
 * цель недели, прогноз, серия, баллы школы, достижения, календарь и план
 * недели — вместе с их запросами (student_home_activity, журнал ДЗ, todo,
 * каталог, прогноз, баллы, синхронизация наград, даты уроков, учебный план).
 * Сроки ДЗ — на странице «Домашние задания».
 *
 * Подписка (§290-B, §289): тем, кому подписка открыта, — `student_path_home()`:
 * ученик «с улицы» без анкеты — на `/start`; плашка пробного/доступа
 * (SubscriptionPathCard, без своего «Продолжить урок» — карточка одна, эта) и
 * маленькая «Пройдите диагностику». Подписка закрыта (школьники) — запроса нет.
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

  const progress = useMemo(() => homeCourses.courses ?? [], [homeCourses.courses])
  const next = useMemo(() => primaryContinue(courses, progress), [courses, progress])
  const items = useMemo(() => {
    const byId = new Map(progress.map(p => [p.courseId, p]))
    return courses.map(c => ({
      courseId: c.courseId, groupId: c.groupId, title: c.courseTitle, subject: c.subject,
      progress: byId.get(c.courseId) ?? null,
    }))
  }, [courses, progress])

  if (path.data?.onboarding.needed) return <Navigate to="/start" replace />

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
        {countdown && <ExamCountdownPill countdown={countdown} />}
      </header>

      {/* §224.2. Идущий / ближайший пробник — первым: пока окно открыто, это
          главное действие дня. Подпись курса — курсов бывает два. */}
      {courses.map(c => (
        <MockExamAlert key={c.groupId} exams={mocksByGroup[c.groupId] ?? []} groupId={c.groupId} context={c.courseTitle} />
      ))}

      {/* §290-B: плашка пробного/доступа; §289: «Пройдите диагностику» */}
      {path.data && <SubscriptionPathCard subscriptions={path.data.subscriptions} showContinue={false} />}
      <DiagnosticHomeCard onboarding={path.data?.onboarding} />

      {next && <ContinueLessonCard groupId={next.course.groupId} courseTitle={next.course.courseTitle} next={next.next} />}

      <CourseProgressCard items={items} />
    </div>
  )
}
