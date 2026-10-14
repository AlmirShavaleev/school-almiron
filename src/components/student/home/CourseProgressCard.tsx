import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { getSubjectColor } from '@/lib/subjectColors'
import { continueHref, type HomeCourseProgress } from '@/lib/studentHomeCourses'

export interface CourseProgressItem {
  courseId: string
  groupId: string
  title: string
  subject: string | null
  /** null — прогресс ещё грузится или не пришёл: карточка без полосок. */
  progress: HomeCourseProgress | null
}

function Bar({ percent, color, label }: { percent: number; color: string; label: string }) {
  return (
    <span
      className="block h-2 overflow-hidden rounded-full bg-graphite-100"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i className={cn('block h-full rounded-full', color)} style={{ width: `${percent}%` }} />
    </span>
  )
}

/**
 * «Мои курсы» и «% по разделам» в одной карточке (письмо 14.10): общий % курса
 * и полоски разделов — доля тем раздела с ДЗ, где ДЗ сдано или принято (та же
 * логика, что «ДЗ принято X из Y»), — и кнопка «Продолжить».
 */
export function CourseProgressCard({ items }: { items: CourseProgressItem[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="home-courses-h" data-testid="courses-card" className="platform-surface space-y-3 rounded-card p-4 sm:p-5">
      <h2 id="home-courses-h" className="text-[15px] font-extrabold text-graphite-950">Мои курсы</h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        {items.map(c => {
          const color = getSubjectColor(c.subject)
          const p = c.progress
          return (
            <article key={c.courseId} data-testid="home-course" className="grid content-start gap-3 rounded-2xl border border-graphite-200 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/my-course/${c.groupId}`} className="flex min-w-0 items-start gap-2 text-[15px] font-extrabold leading-snug text-graphite-950 hover:text-primary-700">
                  <i aria-hidden className={cn('mt-[0.45em] h-2 w-2 shrink-0 rounded-full', color.dot)} />
                  <span className="min-w-0 break-words">{c.title}</span>
                </Link>
                {p && p.total > 0 && (
                  <b className="shrink-0 text-xl font-extrabold tabular-nums text-graphite-950" data-testid="course-percent">{p.percent}%</b>
                )}
              </div>
              {p && p.total > 0 && <Bar percent={p.percent} color={color.dot} label={`${c.title}: ДЗ сдано по темам`} />}
              {p && p.modules.length > 0 && (
                <ul className="grid gap-2" aria-label="Разделы">
                  {p.modules.map(m => (
                    <li key={m.moduleId} className="grid gap-1" data-testid="home-module">
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="min-w-0 break-words text-graphite-700">{m.title}</span>
                        <span className="shrink-0 font-bold tabular-nums text-graphite-900">{m.percent}%</span>
                      </span>
                      <Bar percent={m.percent} color={color.dot} label={`${m.title}: ${m.done} из ${m.total} тем с ДЗ сдано`} />
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to={continueHref(c.groupId, p?.next ?? null)}
                className="inline-flex min-h-11 items-center justify-center rounded-full border-[1.5px] border-graphite-300 bg-white px-4 text-sm font-bold text-graphite-900 transition hover:border-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-10"
              >
                Продолжить
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}
