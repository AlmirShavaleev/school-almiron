import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Loader2 } from 'lucide-react'
import { WeeklyGoalsEditor } from '@/components/goals/WeeklyGoalsEditor'
import {
  NO_GOALS, SUBJECT_ACC, fetchStudentGoalsForStaff, setStudentWeeklyGoals, weeklyGoalTitle, weeklyProgressLabel,
  type ExamGoal, type GoalNumbers, type StaffCourseGoals,
} from '@/lib/studentGoals'
import { cn } from '@/utils/cn'

/**
 * Цели ученика в карточке у преподавателя (письмо ЛК_стиль_настройки_ученика.md,
 * правка 16.10 15:46): цель на экзамен (её ставит ученик — только чтение) и по
 * каждому курсу — цели недели с выполнением, «как у курса» / «своё» и история
 * за 8 недель. Функции ещё нет (миграция не применена) — блока нет.
 */
const DAY = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

function CourseGoals({ studentId, c, onChanged }: { studentId: string; c: StaffCourseGoals; onChanged: () => void }) {
  const [edit, setEdit] = useState<{ custom: boolean; nums: GoalNumbers } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = c.goals.filter(g => g.done).length

  async function save() {
    if (!edit) return
    setBusy(true)
    const res = await setStudentWeeklyGoals(c.courseId, studentId, edit.custom, edit.nums)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setEdit(null); setError(null); onChanged()
  }

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3 first:border-0 first:pt-0" data-testid="student-goals-course">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">
          Цели недели · {c.courseTitle}
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600" data-testid="student-goals-mode">{c.custom ? 'своё' : 'как у курса'}</span>
        </span>
        {c.goals.length > 0 && <span className="text-xs text-gray-500" data-testid="student-goals-staff-summary">выполнено {done} из {c.goals.length}</span>}
      </div>

      {c.goals.length === 0 ? (
        <p className="text-sm text-gray-400">Целей недели нет</p>
      ) : (
        <ul className="space-y-2">
          {c.goals.map(g => (
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

      {c.history.length > 0 && (
        <div data-testid="student-goals-history">
          <p className="mb-1 text-xs text-gray-500">Последние 8 недель</p>
          <div className="flex flex-wrap gap-1">
            {c.history.map(h => {
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

      {edit ? (
        <div className="space-y-3 rounded-xl bg-gray-50 p-3">
          <div className="flex gap-1" role="group" aria-label="Цели ученика">
            {([false, true] as const).map(v => (
              <button key={String(v)} type="button" aria-pressed={edit.custom === v}
                onClick={() => setEdit({ ...edit, custom: v })}
                className={cn('rounded-lg border px-3 py-1 text-sm font-semibold', edit.custom === v ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-700')}>
                {v ? 'Своё' : 'Как у курса'}
              </button>
            ))}
          </div>
          {edit.custom && <WeeklyGoalsEditor value={edit.nums} onChange={nums => setEdit({ ...edit, nums })} disabled={busy} />}
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void save()} data-testid="student-goals-save"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />}Сохранить
            </button>
            <button type="button" className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setEdit(null)}>Отмена</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <button type="button" className="text-sm font-semibold text-primary-700 hover:underline" data-testid="student-goals-edit"
          onClick={() => setEdit({ custom: c.custom, nums: c.ownGoals ?? (c.custom ? NO_GOALS : c.courseGoals) })}>
          Изменить цели ученику
        </button>
      )}
    </div>
  )
}

export function StudentGoalsStaffBlock({ studentId }: { studentId: string }) {
  const [data, setData] = useState<{ exam: ExamGoal[]; courses: StaffCourseGoals[] } | null>(null)
  const load = useCallback(() => {
    fetchStudentGoalsForStaff(studentId).then(r => setData(r.error ? null : r))
  }, [studentId])
  useEffect(() => { load() }, [load])

  if (!data) return null
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
      {data.courses.map(c => <CourseGoals key={c.courseId} studentId={studentId} c={c} onChanged={load} />)}
    </section>
  )
}
