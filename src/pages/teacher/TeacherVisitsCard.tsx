import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTeacherStudentVisits } from '@/hooks/useTeacherStudentActivity'
import { mskTime } from '@/lib/mockExamLesson'
import { plural } from '@/lib/plural'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

const dayFormat = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
})

const relativeDays = ['Сегодня', 'Вчера', 'Позавчера']
const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`))

function visitTime(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return 'меньше минуты'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `≈ ${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `≈ ${hours} ч ${remainder} мин` : `≈ ${hours} ч`
}

export function TeacherVisitsCard({ courseIds, visitedWeek, enrolled, activeShare }: {
  courseIds: string[] | null
  visitedWeek: number
  enrolled: number
  activeShare: number | null
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()

  return (
    <div className="platform-surface min-w-0 rounded-2xl">
      <button
        type="button" aria-expanded={open} aria-controls={open ? detailsId : undefined}
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-start justify-between gap-2 rounded-2xl p-4 text-left transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        <span>
          <span className="block text-sm text-graphite-700">Заходили за 7 дней</span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-graphite-950">{visitedWeek} из {enrolled}</span>
          {activeShare != null && <span className="mt-1 block text-xs text-graphite-600">{activeShare} % учеников</span>}
        </span>
        <ChevronDown size={18} className={`mt-0.5 shrink-0 text-primary-700 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <TeacherVisitsDetails id={detailsId} courseIds={courseIds} />}
    </div>
  )
}

function TeacherVisitsDetails({ id, courseIds }: { id: string; courseIds: string[] | null }) {
  const { students, loading, failed, reload } = useTeacherStudentVisits(courseIds)
  const [period, setPeriod] = useState<string | null>(null)
  const days = students[0]?.days.map(day => day.day) ?? []
  const week = period === 'week'
  const activeDay = period !== null && days.includes(period) ? period : days[0]
  const options = days.map((day, index) => ({ value: day, label: relativeDays[index] ?? formatDay(day) }))
  const rows = students.flatMap(student => {
    const visits = student.days.filter(day => day.visited && (week || day.day === activeDay))
    return visits.length ? [{ ...student, firstVisit: visits[0], daysVisited: visits.length }] : []
  })

  return (
    <div id={id} className="border-t border-graphite-100 p-4">
      {loading ? (
        <p role="status" className="text-sm text-graphite-600">Загружаем заходы учеников…</p>
      ) : failed ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-verdict-bad-ink">Не удалось загрузить заходы учеников.</p>
          <Button size="sm" variant="secondary" onClick={reload}>Повторить</Button>
        </div>
      ) : !students.length ? (
        <p className="text-sm text-graphite-600">В активных группах пока нет учеников с аккаунтом.</p>
      ) : (
        <>
          <div role="group" aria-label="Период заходов" className="flex flex-wrap gap-1.5">
            {[...options, { value: 'week', label: 'За неделю' }].map(option => {
              const pressed = option.value === (week ? 'week' : activeDay)
              return (
                <button
                  key={option.value}
                  type="button" aria-pressed={pressed}
                  onClick={() => setPeriod(option.value === days[0] ? null : option.value)}
                  className={cn(
                    'min-h-10 rounded-lg px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600',
                    pressed ? 'bg-primary-100 text-primary-800' : 'bg-white text-graphite-700 hover:bg-primary-50',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-sm tabular-nums text-graphite-700" aria-live="polite">
            {week ? 'Последние 7 дней' : activeDay ? formatDay(activeDay) : null}
            {' · '}{rows.length} {plural(rows.length, 'ученик', 'ученика', 'учеников')}
          </p>
          {rows.length ? (
            <div className="mt-2 max-h-80 overflow-auto">
              <table aria-label={week ? 'Кто заходил за неделю' : 'Кто заходил в выбранный день'} className="w-full text-left text-xs tabular-nums sm:text-sm">
                <thead className="text-graphite-600">
                  <tr>
                    <th scope="col" className="py-2 pr-2 font-medium">Ученик</th>
                    {week ? <th scope="col" className="py-2 text-right font-medium">Дней с заходом</th> : (
                      <>
                        <th scope="col" className="py-2 pr-2 font-medium">Первый заход</th>
                        <th scope="col" className="py-2 font-medium">Время на сайте</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-graphite-100 border-y border-graphite-100 text-graphite-900">
                  {rows.map(({ student_id, full_name, firstVisit, daysVisited }) => (
                    <tr key={student_id}>
                      <th scope="row" className="break-words py-2 pr-2 font-medium">{full_name}</th>
                      {week ? <td className="py-2 text-right">{daysVisited}</td> : (
                        <>
                          <td className="py-2 pr-2">
                            {firstVisit.first_visit_at
                              ? <time dateTime={firstVisit.first_visit_at}>{mskTime(firstVisit.first_visit_at)}</time>
                              : '—'}
                          </td>
                          <td className="py-2">{visitTime(firstVisit.seconds)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-graphite-600">
              {week ? 'За неделю никто не заходил.' : 'В этот день никто не заходил.'}
            </p>
          )}
          {!week && rows.length > 0 && (
            <p className="mt-3 text-pretty text-xs text-graphite-600">
              Заходы по Москве. Время приблизительное, по отметкам видимой вкладки.
            </p>
          )}
        </>
      )}
    </div>
  )
}
