import { WEEKLY_KINDS, WEEKLY_OPTIONS, weeklyGoalTitle, type GoalNumbers, type WeeklyKind } from '@/lib/studentGoals'
import { cn } from '@/utils/cn'

/**
 * Выбор целей недели (письмо ЛК_стиль_настройки_ученика.md, правка 16.10
 * 17:45 — цели ставит сам ученик): галочками 1–3 стандартные цели, у каждой
 * одно число кнопками, без ввода текста. Набор и числа — `WEEKLY_OPTIONS`.
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
