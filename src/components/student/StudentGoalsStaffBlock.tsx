import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import {
  SUBJECT_ACC, fetchStudentGoalsForStaff, goalProgressLabel, goalTitle,
  type ExamGoal, type RegularGoal,
} from '@/lib/studentGoals'
import { cn } from '@/utils/cn'

/**
 * Цели ученика в карточке у преподавателя (письмо ЛК_стиль_настройки_ученика.md,
 * 16.10): цель на экзамен, которую ученик поставил себе, и цели недели с
 * выполнением. Только чтение — `student_goals_for_staff` (персонал курса
 * ученика или админ). Функции ещё нет (миграция не применена) — блока нет.
 */
export function StudentGoalsStaffBlock({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{ exam: ExamGoal[]; weekly: RegularGoal[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStudentGoalsForStaff(studentId).then(r => { if (!cancelled) setData(r.error ? null : r) })
    return () => { cancelled = true }
  }, [studentId])

  if (!data) return null
  const done = data.weekly.filter(g => g.done).length

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="student-goals-staff">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <CalendarCheck size={18} className="text-primary-600" aria-hidden />Цели ученика
      </h2>
      <p className="mt-1 text-sm text-gray-700" data-testid="student-goals-staff-exam">
        {data.exam.length > 0
          ? data.exam.map(g => `Сдать ${SUBJECT_ACC[g.subject]} на ${g.goal}+`).join(' · ')
          : <span className="text-gray-400">Цель на экзамен не поставил</span>}
      </p>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">Цели недели</span>
          {data.weekly.length > 0 && <span className="text-xs text-gray-500" data-testid="student-goals-staff-summary">выполнено {done} из {data.weekly.length}</span>}
        </div>
        {data.weekly.length === 0 ? (
          <p className="mt-1 text-sm text-gray-400">Целей недели нет</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.weekly.map(g => (
              <li key={g.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-gray-800">{goalTitle(g)}</span>
                  <span className={cn('shrink-0 tabular-nums', g.done ? 'font-semibold text-emerald-700' : 'text-gray-500')}>
                    {g.done ? '✓ выполнено' : goalProgressLabel(g)}
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
    </section>
  )
}
