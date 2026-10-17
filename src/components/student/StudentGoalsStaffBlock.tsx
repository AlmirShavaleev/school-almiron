import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import {
  SUBJECT_ACC, fetchStudentGoalsForStaff, weeklyGoalTitle, weeklyProgressLabel, type StaffGoals,
} from '@/lib/studentGoals'
import { cn } from '@/utils/cn'

/**
 * Цели ученика в карточке у преподавателя (письмо ЛК_стиль_настройки_ученика.md,
 * правка 16.10 17:45): цели ставит сам ученик — здесь только чтение. Цель на
 * экзамен, цели недели с выполнением и история за 8 недель (с теми целями, что
 * действовали тогда). Функции ещё нет (миграция не применена) — блока нет.
 */
const DAY = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

export function StudentGoalsStaffBlock({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StaffGoals | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStudentGoalsForStaff(studentId).then(r => { if (!cancelled) setData(r.data) })
    return () => { cancelled = true }
  }, [studentId])

  if (!data) return null
  const done = data.goals.filter(g => g.done).length

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="student-goals-staff">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <CalendarCheck size={18} className="text-primary-600" aria-hidden />Цели ученика
      </h2>
      <p className="text-sm text-gray-700" data-testid="student-goals-staff-exam">
        {data.exam.length > 0
          ? data.exam.map(g => `Сдать ${SUBJECT_ACC[g.subject]} на ${g.goal}+`).join(' · ')
          : <span className="text-gray-400">Цель на экзамен не поставил</span>}
      </p>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">Цели недели <span className="font-normal text-gray-400">· ставит сам ученик</span></span>
          {data.goals.length > 0 && <span className="text-xs text-gray-500" data-testid="student-goals-staff-summary">выполнено {done} из {data.goals.length}</span>}
        </div>
        {data.goals.length === 0 ? (
          <p className="text-sm text-gray-400">Цели на неделю ученик не ставил</p>
        ) : (
          <ul className="space-y-2">
            {data.goals.map(g => (
              <li key={g.kind} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-gray-800">{weeklyGoalTitle(g.kind, g.target)}</span>
                  <span className={cn('shrink-0 tabular-nums', g.done ? 'font-semibold text-emerald-700' : 'text-gray-500')}>
                    {g.done ? '✓ выполнено' : weeklyProgressLabel(g)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div className={cn('h-full rounded-full', g.done ? 'bg-emerald-500' : 'bg-primary-500')} style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.history.length > 0 && (
        <div data-testid="student-goals-history">
          <p className="mb-1 text-xs text-gray-500">Последние 8 недель</p>
          <div className="flex flex-wrap gap-1">
            {data.history.map(h => {
              const ok = h.total > 0 && h.done === h.total
              return (
                <span
                  key={h.weekStart}
                  title={`Неделя с ${DAY(h.weekStart)}: ${h.total ? `выполнено ${h.done} из ${h.total}` : 'целей не было'}`}
                  className={cn(
                    'inline-flex h-7 min-w-11 items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums',
                    h.total === 0 ? 'bg-gray-50 text-gray-300' : ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-50 text-amber-800',
                  )}
                >
                  {h.total ? `${h.done}/${h.total}` : '—'}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
