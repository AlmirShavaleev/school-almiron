import { Link } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useMyStudentId } from '@/hooks/useMyTopicHomework'
import { JournalView } from '@/components/journal/JournalView'

/**
 * §257. «Журнал занятий и заданий» ученика — отдельной страницей.
 *
 * Жил внизу «Мой прогресс». Страницу заменили «Достижения», и журнал не
 * потерялся: он открывается из «Подробной статистики» (`/my-journal`). Сам
 * журнал не тронут — тот же `JournalView`, уроки ведут на `/lessons/:id`.
 */
export function MyJournalPage() {
  const { studentId, loading } = useMyStudentId()

  return (
    <div className="mx-auto grid max-w-[1120px] gap-3.5" data-testid="my-journal-page">
      <Link to="/achievements" className="inline-flex w-max items-center gap-1 text-sm font-semibold text-primary-700 hover:underline">
        <ChevronLeft size={15} aria-hidden />Достижения
      </Link>
      <h1 className="text-2xl font-extrabold tracking-tight text-graphite-950 sm:text-[1.55rem]">Журнал занятий и заданий</h1>
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 size={26} className="animate-spin text-primary-600" /></div>
      ) : studentId ? (
        <JournalView
          studentId={studentId}
          viewerRole="student"
          lessonHref={lessonId => `/lessons/${lessonId}`}
        />
      ) : (
        <p className="text-sm text-graphite-500">Профиль ученика не найден. Обратитесь к администратору.</p>
      )}
    </div>
  )
}
