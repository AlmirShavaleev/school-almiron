import { Link } from 'react-router-dom'
import { summaryFor, type StudyPlanBoard } from '@/lib/studyPlanBoard'
import { cn } from '@/utils/cn'

/**
 * Таблица ученики × недели. В клетке — сколько тем недели зачтено; цвет
 * говорит о просрочке. Подробности по клетке (какие темы, отметки, ДЗ не
 * опубликовано) — в панели ниже по клику, чтобы таблица на 16 × 85 не
 * превращалась в стену текста.
 *
 * На телефоне (390) таблица не показывается вовсе — там работает отчёт по
 * неделе: селектор недели и список учеников с тем же содержимым клетки.
 */
export function PlanBoardTable({
  board, weeks, selected, onSelect,
}: {
  board: StudyPlanBoard
  weeks: number[]
  selected: { si: number; week: number } | null
  onSelect: (si: number, week: number) => void
}) {
  const current = board.plan?.current_week ?? 0

  if (board.students.length === 0) {
    return <p className="text-sm text-gray-500">В группе курса пока нет учеников.</p>
  }
  if (weeks.length === 0) {
    return <p className="text-sm text-gray-500">Темы ещё не разложены по неделям.</p>
  }

  return (
    <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 bg-white" data-testid="plan-board-table">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-gray-500 border-b border-gray-200">Ученик</th>
            {weeks.map(w => (
              <th
                key={w}
                className={cn(
                  'px-1.5 py-2 text-center font-medium tabular-nums border-b border-gray-200 min-w-[2.75rem]',
                  w === current ? 'text-primary-700 bg-primary-50' : 'text-gray-500',
                )}
                title={`Неделя ${w}`}
              >
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.students.map((student, si) => (
            <tr key={student.student_id} className="border-b border-gray-100 last:border-0">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                <Link to={`/students/${student.student_id}`} className="text-gray-900 hover:text-primary-700">
                  {student.full_name}
                </Link>
              </td>
              {weeks.map(w => {
                const s = summaryFor(board, si, w)
                const isSel = selected?.si === si && selected.week === w
                const tone = !s || s.total === 0
                  ? 'text-gray-300'
                  : s.overdue > 0
                    ? 'bg-red-50 text-red-700'
                    : s.done >= s.total
                      ? 'bg-green-50 text-green-700'
                      : s.done > 0
                        ? 'bg-amber-50 text-amber-700'
                        : 'text-gray-600'
                return (
                  <td key={w} className={cn('p-0.5 text-center', w === current && 'bg-primary-50/40')}>
                    <button
                      type="button"
                      onClick={() => onSelect(si, w)}
                      data-testid="plan-cell"
                      data-week={w}
                      data-student={si}
                      className={cn(
                        'w-full min-h-8 rounded-md tabular-nums transition-colors hover:ring-1 hover:ring-primary-300',
                        tone,
                        isSel && 'ring-2 ring-primary-500',
                      )}
                      title={s && s.total > 0
                        ? `Неделя ${w}: зачтено ${s.done} из ${s.total}${s.overdue > 0 ? `, просрочено ${s.overdue}` : ''}`
                        : `Неделя ${w}: тем нет`}
                    >
                      {s && s.total > 0 ? `${s.done}/${s.total}` : '·'}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
