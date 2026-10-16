import { useEffect, useState } from 'react'
import { CalendarCheck, Loader2 } from 'lucide-react'
import {
  NO_GOALS, WEEKLY_KINDS, WEEKLY_OPTIONS, fetchCourseWeeklyGoals, setCourseWeeklyGoals, weeklyGoalTitle,
  type GoalNumbers, type WeeklyKind,
} from '@/lib/studentGoals'
import { cn } from '@/utils/cn'

/**
 * Цели недели в кабинете преподавателя (письмо ЛК_стиль_настройки_ученика.md,
 * правка 16.10 15:46): галочками выбрать 1–3 стандартные цели, у каждой одно
 * число. Набор и числа — `WEEKLY_OPTIONS`.
 */
const NOUN: Record<WeeklyKind, string> = { days: 'дней в неделю на платформе', topics: 'тем за неделю', tasks: 'задач в тренировке' }
const DEFAULT: Record<WeeklyKind, number> = { days: 4, topics: 3, tasks: 20 }

export function WeeklyGoalsEditor({ value, onChange, disabled }: {
  value: GoalNumbers
  onChange: (v: GoalNumbers) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2.5">
      {WEEKLY_KINDS.map(k => {
        const on = value[k] != null
        return (
          <div key={k} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid={`weekly-goal-edit-${k}`}>
            <label className="flex min-w-[220px] items-center gap-2 text-sm font-medium text-gray-900">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => onChange({ ...value, [k]: on ? null : DEFAULT[k] })}
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
              />
              {on ? weeklyGoalTitle(k, value[k] as number) : weeklyGoalTitle(k, DEFAULT[k]).replace(String(DEFAULT[k]), 'N')}
            </label>
            {on && (
              <div className="flex gap-1" role="group" aria-label={`Сколько ${NOUN[k]}`}>
                {WEEKLY_OPTIONS[k].map(n => (
                  <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    aria-pressed={value[k] === n}
                    onClick={() => onChange({ ...value, [k]: n })}
                    className={cn(
                      'min-w-9 rounded-lg border px-2 py-1 text-sm font-semibold transition-colors',
                      value[k] === n ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const same = (a: GoalNumbers, b: GoalNumbers) => WEEKLY_KINDS.every(k => a[k] === b[k])

/** Блок «Цели недели» курса: применяется ко всем ученикам курса (у кого нет «своего»). */
export function CourseWeeklyGoalsBlock({ courseId, onSaved }: { courseId: string; onSaved?: () => void }) {
  const [saved, setSaved] = useState<GoalNumbers | null>(null)
  const [draft, setDraft] = useState<GoalNumbers>(NO_GOALS)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCourseWeeklyGoals(courseId).then(g => { if (!cancelled) { setSaved(g); setDraft(g ?? NO_GOALS) } })
    return () => { cancelled = true }
  }, [courseId])

  // Функции ещё нет (миграция не применена) — блока нет.
  if (saved == null) return null

  async function save() {
    setBusy(true)
    const res = await setCourseWeeklyGoals(courseId, draft)
    setBusy(false)
    if (res.error) { setMsg(res.error); return }
    setSaved(draft); setMsg('Сохранено — цели у всех учеников курса'); onSaved?.()
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="course-weekly-goals">
      <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <CalendarCheck size={18} className="text-primary-600" aria-hidden />Цели недели
      </h3>
      <p className="mb-3 mt-0.5 text-sm text-gray-500">Для всех учеников курса. Ученику можно поставить своё — в его карточке. Неделя пн–вс.</p>
      <WeeklyGoalsEditor value={draft} onChange={v => { setDraft(v); setMsg(null) }} disabled={busy} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || same(draft, saved)}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          data-testid="course-weekly-goals-save"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}Сохранить
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </section>
  )
}
