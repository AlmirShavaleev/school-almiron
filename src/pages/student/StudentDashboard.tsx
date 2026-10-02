import { useMemo } from 'react'
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
import { courseCards } from '@/lib/studentHome'

/**
 * Главная ученика (§254, макет владельца 02.10).
 *
 * Сверху — шапка с серией и кнопки-счётчики «что сдать» (ведут на страницу
 * ДЗ нужным списком); ниже сетка в две колонки: слева «Решено задач по
 * неделям», справа «Серия»; внизу «Эта неделя» по плану (§151) и «Мои курсы».
 *
 * Сетка оставлена под §255: в левую колонку ПЕРВОЙ встаёт карточка «Примерный
 * балл на ЕГЭ», в правую ПОД «Серией» — «Баллы школы». Пока их нет, в каждой
 * колонке по одной карточке, и обе тянутся на высоту строки (`flex-1`) —
 * колонки не выглядят дырявыми. Когда §255 добавит карточки, растягивается
 * последняя в колонке — перестраивать страницу не нужно.
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
        {home.activity && <StreakPill activity={home.activity} />}
      </header>

      {/* §224.2. Идущий / ближайший пробник — над кнопками: это главное
          действие дня, пока окно открыто. Подпись курса — курсов бывает два. */}
      {courses.map(c => (
        <MockExamAlert key={c.groupId} exams={mocksByGroup[c.groupId] ?? []} groupId={c.groupId} context={c.courseTitle} />
      ))}

      <HomeActions todo={todo} loading={todoLoading} error={todoError} />

      <div className="grid grid-cols-1 gap-3.5 min-[900px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5" data-slot="left">
          {/* §255: «Примерный балл на ЕГЭ» — сюда, первой карточкой колонки. */}
          <WeeklySolvedCard activity={home.activity} error={home.error} onRetry={home.retry} className="flex-1" />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5" data-slot="right">
          <StreakCard activity={home.activity} error={home.error} onRetry={home.retry} className="flex-1" />
          {/* §255: «Баллы школы» — сюда, под «Серией». */}
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
