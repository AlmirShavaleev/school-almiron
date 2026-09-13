import { Link } from 'react-router-dom'
import { formatWeekRange, weekReport, type StudyPlanBoard, type WeekReportRow } from '@/lib/studyPlanBoard'
import { cn } from '@/utils/cn'

/**
 * Отчёт по неделе: кто закрыл план полностью, кто частично, кто не начал —
 * поимённо. Имя ведёт на карточку ученика (`/students/:student_id`, не
 * profile_id — ловушка §148): число без выхода на человека бесполезно (§147).
 *
 * На телефоне этот же блок заменяет таблицу: селектор недели + список.
 */
export function WeekReport({
  board, weeks, week, onWeekChange, onSelectStudent,
}: {
  board: StudyPlanBoard
  weeks: number[]
  week: number
  onWeekChange: (week: number) => void
  onSelectStudent: (si: number) => void
}) {
  const plan = board.plan!
  const report = weekReport(board, week)

  if (weeks.length === 0) return null

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-testid="week-report">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Отчёт по неделе</h2>
        <select
          value={week}
          onChange={e => onWeekChange(Number(e.target.value))}
          aria-label="Неделя"
          data-testid="week-report-select"
          className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm"
        >
          {weeks.map(w => (
            <option key={w} value={w}>
              Неделя {w} · {formatWeekRange(plan.start_date, w)}{w === plan.current_week ? ' · сейчас' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Stat label="полностью" n={report.full.length} tone="text-green-700 bg-green-50" href="#report-full" />
        <Stat label="частично" n={report.partial.length} tone="text-amber-700 bg-amber-50" href="#report-partial" />
        <Stat label="не начали" n={report.none.length} tone="text-red-700 bg-red-50" href="#report-none" />
        {report.empty.length > 0 && (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">без тем: {report.empty.length}</span>
        )}
      </div>

      <Group id="report-full" title="Закрыли полностью" rows={report.full} onSelectStudent={onSelectStudent} />
      <Group id="report-partial" title="Частично" rows={report.partial} onSelectStudent={onSelectStudent} />
      <Group id="report-none" title="Не начали" rows={report.none} onSelectStudent={onSelectStudent} />
    </section>
  )
}

function Stat({ label, n, tone, href }: { label: string; n: number; tone: string; href: string }) {
  return (
    <a href={href} className={cn('rounded-full px-2.5 py-1 text-xs font-medium', tone)}>
      {label}: <span className="tabular-nums">{n}</span>
    </a>
  )
}

function Group({
  id, title, rows, onSelectStudent,
}: {
  id: string
  title: string
  rows: WeekReportRow[]
  onSelectStudent: (si: number) => void
}) {
  if (rows.length === 0) return null
  return (
    <div id={id} data-testid={id}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title} · {rows.length}</h3>
      <ul className="divide-y divide-gray-100">
        {rows.map(row => (
          <li key={row.student.student_id} className="flex items-center gap-2 min-h-10 py-1">
            <Link to={`/students/${row.student.student_id}`} className="min-w-0 flex-1 text-sm text-gray-900 hover:text-primary-700 truncate">
              {row.student.full_name}
            </Link>
            <span className={cn('text-xs tabular-nums', row.overdue > 0 ? 'text-red-600' : 'text-gray-500')}>
              {row.done}/{row.total}{row.overdue > 0 ? ` · просрочено ${row.overdue}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onSelectStudent(row.si)}
              className="min-h-9 rounded-lg px-2 text-xs text-primary-700 hover:bg-primary-50"
            >
              темы
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
