import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { getSubjectColor } from '@/lib/subjectColors'
import type { CourseCard } from '@/lib/studentHome'

/**
 * §254. «Мои курсы»: тем пройдено (только `topic_done_events`, §152/§162),
 * ДЗ принято, средняя оценка; вся карточка — ссылка на курс.
 */
export function MyCoursesCard({ cards }: { cards: CourseCard[] }) {
  if (cards.length === 0) return null
  return (
    <section aria-labelledby="home-courses-h" data-testid="courses-card" className="platform-surface space-y-3 rounded-card p-4 sm:p-5">
      <h2 id="home-courses-h" className="text-[15px] font-extrabold text-graphite-950">Мои курсы</h2>
      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        {cards.map(c => {
          const color = getSubjectColor(c.subject)
          const pct = c.topicsTotal ? Math.round(((c.topicsDone ?? 0) / c.topicsTotal) * 100) : 0
          return (
            <Link
              key={c.courseId}
              to={`/my-course/${c.groupId}`}
              data-testid="home-course"
              className="grid gap-2 rounded-2xl border border-graphite-200 p-3 transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="flex min-w-0 items-start gap-2 text-[15px] font-extrabold leading-snug text-graphite-950">
                <i aria-hidden className={cn('mt-[0.45em] h-2 w-2 shrink-0 rounded-full', color.dot)} />
                <span className="min-w-0 break-words">{c.title}</span>
              </span>
              <span
                className="block h-2 overflow-hidden rounded-full bg-graphite-100"
                role="progressbar"
                aria-label="Тем пройдено"
                aria-valuemin={0}
                aria-valuemax={c.topicsTotal ?? 0}
                aria-valuenow={c.topicsDone ?? 0}
              >
                <i className={cn('block h-full rounded-full', color.dot)} style={{ width: `${pct}%` }} />
              </span>
              <span className="grid grid-cols-3 gap-2">
                <Num value={c.topicsTotal == null ? '—' : `${c.topicsDone} / ${c.topicsTotal}`} label="тем пройдено" />
                <Num value={`${c.hwAccepted} / ${c.hwTotal}`} label="ДЗ принято" />
                <Num value={c.average} label="средняя оценка" />
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function Num({ value, label }: { value: string; label: string }) {
  return (
    <span className="min-w-0">
      <b className="block font-bold tabular-nums text-graphite-950">{value}</b>
      <small className="text-xs text-graphite-500">{label}</small>
    </span>
  )
}
