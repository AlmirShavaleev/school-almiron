import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTeacherHomeworkSubmissions } from '@/hooks/useTeacherStudentActivity'
import type { TeacherActivityDays, TeacherActivitySeries } from '@/hooks/useTeacherActivity'
import { TeacherActivityChart } from '@/pages/teacher/TeacherActivityChart'
import { mskTime } from '@/lib/mockExamLesson'

export function TeacherSubmissionsCard({ courseIds, days, series, todayCount, asOf }: {
  courseIds: string[] | null
  days: TeacherActivityDays
  series: TeacherActivitySeries | null | undefined
  todayCount: number
  asOf: string
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()

  return (
    <div className="min-w-0 space-y-2">
      <TeacherActivityChart metric="submissions" days={days} series={series}>
        <button
          type="button" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
          onClick={() => setExpanded(open => !open)}
          className="inline-flex items-center gap-1 rounded-sm font-semibold text-primary-700 underline underline-offset-2 hover:text-primary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          Сегодня {todayCount}
          <ChevronDown size={13} aria-hidden className={expanded ? 'rotate-180' : undefined} />
        </button>
      </TeacherActivityChart>
      {expanded && <TodaySubmissions id={listId} courseIds={courseIds} asOf={asOf} />}
    </div>
  )
}

function TodaySubmissions({ id, courseIds, asOf }: { id: string; courseIds: string[] | null; asOf: string }) {
  const { rows, loading, failed, reload } = useTeacherHomeworkSubmissions(courseIds, asOf)
  const titleId = useId()

  return (
    <section id={id} aria-labelledby={titleId} className="platform-surface rounded-2xl p-4">
      <h3 id={titleId} className="text-sm font-bold text-graphite-950">Сдачи ДЗ сегодня</h3>
      {loading ? (
        <p role="status" className="mt-2 text-sm text-graphite-600">Загружаем сегодняшние сдачи…</p>
      ) : failed ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-verdict-bad-ink">Не удалось загрузить сегодняшние сдачи.</p>
          <Button size="sm" variant="secondary" onClick={reload}>Повторить</Button>
        </div>
      ) : rows.length ? (
        <ul className="mt-2 divide-y divide-graphite-100">
          {rows.map(row => (
            <li key={row.attempt_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2">
              <div className="min-w-0 break-words">
                <p className="text-sm font-semibold text-graphite-950">{row.full_name}</p>
                <p className="text-sm text-graphite-700">{row.topic_title}</p>
              </div>
              <time dateTime={row.submitted_at} className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-graphite-600">
                {mskTime(row.submitted_at)} МСК
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-graphite-600">Сегодня ещё нет сдач домашних работ.</p>
      )}
    </section>
  )
}
