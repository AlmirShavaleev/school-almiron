import { useState } from 'react'
import { Activity, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTeacherActivity, useTeacherActivityPeriod, type TeacherActivityDays } from '@/hooks/useTeacherActivity'
import { useTeacherPresence } from '@/hooks/useTeacherStudentActivity'
import { PRESENCE_WINDOW_S } from '@/lib/schoolPresence'
import { TeacherActivityChart } from '@/pages/teacher/TeacherActivityChart'
import { TeacherVisitsCard } from '@/pages/teacher/TeacherVisitsCard'
import { TeacherSubmissionsCard } from '@/pages/teacher/TeacherSubmissionsCard'
import { cn } from '@/utils/cn'

const periods = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 365, label: 'Год' },
] as const

export function TeacherActivityPanel({ courseIds }: { courseIds: string[] | null }) {
  const [days, setDays] = useState<TeacherActivityDays>(7)
  const { data, loading, failed, reload } = useTeacherActivity(courseIds)
  const period = useTeacherActivityPeriod(courseIds, days, data?.asOf)
  const presence = useTeacherPresence(courseIds)
  const activeShare = data?.enrolled ? Math.round(100 * data.visitedWeek / data.enrolled) : null
  const series = days === 7 ? data?.week : period.data

  return (
    <section className="space-y-3" aria-labelledby="teacher-activity-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="teacher-activity-heading" className="flex items-center gap-2 text-lg font-bold text-graphite-950">
          <Activity size={20} className="text-primary-700" aria-hidden /> Активность учеников
        </h2>
        {courseIds?.length !== 0 && (
          <Button size="sm" variant="secondary" onClick={() => { reload(); presence.reload() }} disabled={loading || presence.loading}>
            <RefreshCw size={14} aria-hidden /> Обновить
          </Button>
        )}
      </div>

      {courseIds?.length !== 0 && (
        <section className="platform-surface rounded-2xl p-4" aria-labelledby="teacher-presence-heading">
          <h3 id="teacher-presence-heading" className="flex items-center gap-2 text-sm font-semibold text-graphite-950">
            <Radio size={16} className={presence.failed ? 'text-graphite-400' : 'text-verdict-ok-ink'} aria-hidden />
            Сейчас на платформе
          </h3>
          <p className="mt-1 text-xs text-graphite-600">Ваши ученики, активные за последние {PRESENCE_WINDOW_S / 60} минут</p>
          {presence.loading ? (
            <p className="mt-3 text-sm text-graphite-600" role="status">Проверяем, кто онлайн…</p>
          ) : presence.failed ? (
            <p className="mt-3 text-sm text-verdict-bad-ink" role="alert">Не удалось загрузить список учеников онлайн.</p>
          ) : presence.students.length === 0 ? (
            <p className="mt-3 text-sm text-graphite-600">Сейчас никого из ваших учеников нет на платформе.</p>
          ) : (
            <>
              <p className="mt-2 text-3xl font-bold tabular-nums text-graphite-950" aria-label="Учеников онлайн">
                {presence.students.length}
              </p>
              <ul aria-label="Ученики онлайн" className="mt-2 flex flex-wrap gap-1.5">
                {presence.students.map(student => (
                  <li key={student.student_id} className="max-w-full rounded-lg bg-slate-100 px-2 py-1 text-xs text-graphite-900">
                    {student.full_name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {loading && <p role="status" className="platform-surface rounded-card p-4 text-sm text-graphite-600">Загружаем активность…</p>}
      {failed && <p role="alert" className="platform-surface rounded-card p-4 text-sm text-verdict-bad-ink">Не удалось загрузить активность учеников.</p>}
      {courseIds?.length === 0 && <p className="platform-surface rounded-card p-4 text-sm text-graphite-600">Активных курсов пока нет.</p>}

      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div role="group" aria-label="Период графиков" className="platform-surface inline-flex rounded-xl border border-graphite-200 p-1">
              {periods.map(option => (
                <button
                  type="button" key={option.days} aria-pressed={days === option.days} onClick={() => setDays(option.days)}
                  className={cn(
                    'min-h-9 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600',
                    days === option.days ? 'bg-primary-50 text-primary-800' : 'text-graphite-700 hover:bg-graphite-50',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-graphite-600">Последние {days} дней · по Москве</p>
          </div>
          {period.loading && <p role="status" className="text-sm text-graphite-600">Загружаем графики за выбранный период…</p>}
          {period.failed && (
            <div className="platform-surface flex flex-wrap items-center justify-between gap-2 rounded-2xl p-4">
              <p role="alert" className="text-sm text-verdict-bad-ink">Не удалось загрузить графики за выбранный период.</p>
              <Button size="sm" variant="secondary" onClick={period.reload}>Повторить</Button>
            </div>
          )}
          <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2">
            <TeacherActivityChart metric="visits" days={days} series={series} />
            <TeacherSubmissionsCard
              courseIds={courseIds} days={days} series={series} asOf={data.asOf}
              todayCount={data.week.submissions.at(-1)?.value ?? 0}
            />
          </div>

          <TeacherVisitsCard courseIds={courseIds} visitedWeek={data.visitedWeek} enrolled={data.enrolled} activeShare={activeShare} />
        </>
      )}
    </section>
  )
}
