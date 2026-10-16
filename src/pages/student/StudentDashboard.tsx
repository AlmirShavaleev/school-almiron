import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useStudentDashboard } from '@/hooks/useStudentDashboard'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { HomeHero } from '@/components/student/home/HomeHero'
import { ActivityCard } from '@/components/student/home/ActivityCard'
import { useStudentActivity } from '@/hooks/useStudentActivity'
import { ContinueLessonCard } from '@/components/student/home/ContinueLessonCard'
import { CourseProgressCard } from '@/components/student/home/CourseProgressCard'
import { examCountdown } from '@/lib/examCountdown'
import { mskDateKey } from '@/lib/homeworkDeadline'
import { continueHref, primaryContinue } from '@/lib/studentHomeCourses'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { SubscriptionPathCard } from '@/components/student/home/SubscriptionPathCard'
import { DiagnosticHomeCard } from '@/components/student/home/DiagnosticHomeCard'
import { GoalsCard, type GoalBasisSource } from '@/components/student/home/GoalsCard'

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
 * Вид — стиль лендинга v3 (письмо ЛК_ученика_в_стиле_лендинга.md, 14.10):
 * первый экран как hero лендинга (приветствие, реплика пузырём, сцена с
 * 3D-стикерами и днями до экзамена), «Продолжить урок» с шагами урока как
 * аргумент 3, курсы карточками. Данные и запросы — прежние.
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

  // Этап 2 ЛК (письмо 15.10): «Посещения по дням» вернулись в новом стиле —
  // одна RPC student_home_activity(84). «Календарь тем» живёт в программе курса
  // (письмо ЛК_стиль_календарь_в_программу_курса.md): на главной он раздувался.
  const activity = useStudentActivity(!!profile?.id, todayMsk)

  // «Цели» (письмо 16.10): основание оценки пути — последний пробник курса
  // предмета с результатом, иначе прогресс курса (как в «Моих курсах»).
  const goalSources = useMemo<GoalBasisSource[]>(() => items.flatMap(it => {
    if (it.subject !== 'math' && it.subject !== 'physics') return []
    const last = (mocksByGroup[it.groupId] ?? [])
      .filter(m => m.score != null && m.max_score)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0]
    return [{
      subject: it.subject,
      mock: last ? { score: last.score as number, max: last.max_score as number } : null,
      course: it.progress ? { done: it.progress.done, total: it.progress.total } : null,
    }]
  }), [items, mocksByGroup])

  if (path.data?.onboarding.needed) return <Navigate to="/start" replace />

  if (dashboard.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[var(--blue)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-8 pb-10 pt-2 sm:gap-10 sm:pt-4" data-testid="student-home">
      <HomeHero
        name={profile?.full_name?.split(' ')[1] || 'Ученик'}
        todayLabel={new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        countdown={countdown}
        next={next ? { title: next.next.title, moduleTitle: next.next.moduleTitle, courseTitle: next.course.courseTitle } : null}
        continueTo={next ? continueHref(next.course.groupId, next.next) : null}
        hasCourses={courses.length > 0}
        coursesOn={subscriptionsOn.enabled}
      />

      {/* §224.2. Идущий / ближайший пробник — первым: пока окно открыто, это
          главное действие дня. Подпись курса — курсов бывает два. */}
      {courses.map(c => (
        <MockExamAlert key={c.groupId} exams={mocksByGroup[c.groupId] ?? []} groupId={c.groupId} context={c.courseTitle} />
      ))}

      {/* §290-B: плашка пробного/доступа; §289: «Пройдите диагностику» */}
      {path.data && <SubscriptionPathCard subscriptions={path.data.subscriptions} showContinue={false} />}
      <DiagnosticHomeCard onboarding={path.data?.onboarding} />

      {next && <ContinueLessonCard groupId={next.course.groupId} courseTitle={next.course.courseTitle} next={next.next} />}

      {courses.length > 0 && profile?.id && <GoalsCard profileId={profile.id} sources={goalSources} />}

      {courses.length > 0 && activity && <ActivityCard grid={activity} />}

      <CourseProgressCard items={items} mainCourseId={next?.course.courseId ?? null} />
    </div>
  )
}
