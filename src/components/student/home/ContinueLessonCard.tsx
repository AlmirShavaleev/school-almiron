import { Link } from 'react-router-dom'
import { ArrowRight, PlayCircle } from 'lucide-react'
import { continueHref, type HomeContinue } from '@/lib/studentHomeCourses'

/**
 * «Продолжить урок» — одна заметная карточка наверху главной: следующая
 * открытая тема с несданным ДЗ (student_home_courses().continue). Подпись
 * курса — курсов бывает два.
 */
export function ContinueLessonCard({ groupId, courseTitle, next }: { groupId: string; courseTitle: string; next: HomeContinue }) {
  return (
    <Link
      to={continueHref(groupId, next)}
      data-testid="continue-lesson"
      className="group flex items-center gap-3.5 rounded-card bg-gradient-to-br from-action-from to-action-to p-4 text-white shadow-action transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 sm:p-5"
    >
      <PlayCircle aria-hidden className="h-10 w-10 shrink-0 opacity-90" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <small className="block text-[13px] font-semibold text-white/85">Продолжить урок · {courseTitle}</small>
        <b className="block break-words text-[17px] font-extrabold leading-snug">{next.title}</b>
        {next.moduleTitle && <small className="block text-[13px] text-white/80">{next.moduleTitle}</small>}
      </span>
      <ArrowRight aria-hidden className="h-6 w-6 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
