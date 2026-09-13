import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { toast } from '@/store/toastStore'
import {
  cellState, cellsFor, formatDayShort, formatWeekRange, type BoardCell, type CellKind, type StudyPlanBoard,
} from '@/lib/studyPlanBoard'
import { cn } from '@/utils/cn'

/**
 * Панель клетки: темы недели у одного ученика и отклонения по нему.
 *
 * В строке темы видно всё, что просил владелец: зачёт (сдано / просрочено /
 * ДЗ не опубликовано) и РЯДОМ отметку «пройдено» — считается по сдаче, но
 * расхождение «отметил, а ДЗ не сдал» подсвечено отдельно.
 *
 * Отклонения ровно двух видов: сдвинуть срок на другую неделю и снять тему
 * с этого ученика. Обе записи — RPC с проверкой прав внутри.
 */
const KIND_TONE: Record<CellKind, string> = {
  done: 'bg-green-50 text-green-700',
  late: 'bg-green-50 text-green-700',
  overdue: 'bg-red-50 text-red-700',
  returned: 'bg-amber-50 text-amber-700',
  waiting: 'bg-gray-100 text-gray-600',
  removed: 'bg-gray-100 text-gray-400',
}

export function StudentWeekDetail({
  board, si, week, weeks, canEdit, busy, onClose, onSetOverride,
}: {
  board: StudyPlanBoard
  si: number
  week: number
  weeks: number[]
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onSetOverride: (studentId: string, topicId: string, next: { week: number } | { removed: true } | null) => Promise<void>
}) {
  const student = board.students[si]
  const plan = board.plan!
  if (!student) return null
  const cells = cellsFor(board, si, week)

  async function change(cell: BoardCell, value: string) {
    const topic = board.topics[cell.ti]
    const next = value === 'remove' ? { removed: true as const } : value === 'reset' ? null : { week: Number(value) }
    try {
      await onSetOverride(student.student_id, topic.topic_id, next)
      toast.saved(value === 'remove' ? 'Тема снята у ученика' : value === 'reset' ? 'Отклонение убрано' : `Срок сдвинут на неделю ${value}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    }
  }

  return (
    <section className="bg-white rounded-xl border border-primary-200 p-4 space-y-3" data-testid="student-week-detail">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            <Link to={`/students/${student.student_id}`} className="hover:text-primary-700">{student.full_name}</Link>
          </h2>
          <p className="text-xs text-gray-500">
            Неделя {week} · {formatWeekRange(plan.start_date, week)} · срок до воскресенья
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="min-h-9 min-w-9 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 inline-flex items-center justify-center">
          <X size={16} />
        </button>
      </div>

      {cells.length === 0 ? (
        <p className="text-sm text-gray-500">На этой неделе у ученика нет тем.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {cells.map(cell => {
            const topic = board.topics[cell.ti]
            const state = cellState(cell)
            return (
              <li key={topic.topic_id} className="py-2 flex flex-wrap items-center gap-2" data-testid="detail-topic">
                <span className={cn('min-w-0 flex-1 basis-48 text-sm break-words', cell.removed ? 'text-gray-400 line-through' : 'text-gray-900')}>
                  {topic.title}
                  {cell.shifted && !cell.removed && (
                    <span className="ml-1 text-[10px] font-semibold uppercase text-primary-700">сдвинуто</span>
                  )}
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_TONE[state.kind])} data-testid="detail-state">
                  {state.label}
                  {cell.done && cell.submittedAt && state.basis === 'homework' && ` ${formatDayShort(cell.submittedAt)}`}
                </span>
                {!cell.removed && state.basis === 'homework' && (
                  <span
                    className={cn('text-xs', state.markedButNotSubmitted ? 'text-amber-700 font-medium' : 'text-gray-500')}
                    data-testid="detail-marks"
                    title={state.markedButNotSubmitted ? 'Отметил пройденной, но ДЗ не сдал' : undefined}
                  >
                    {state.marksLabel}{state.markedButNotSubmitted ? ' · ДЗ не сдано' : ''}
                  </span>
                )}
                {!cell.removed && state.basis === 'marks' && (
                  <span className="text-xs text-gray-500" data-testid="detail-basis">зачёт по отметке · ДЗ не опубликовано</span>
                )}
                {canEdit && (
                  <select
                    value={cell.removed ? 'remove' : cell.shifted ? String(cell.week) : 'reset'}
                    disabled={busy}
                    onChange={e => { void change(cell, e.target.value) }}
                    aria-label={`Отклонение по теме «${topic.title}»`}
                    className="min-h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs"
                  >
                    <option value="reset">по плану</option>
                    {weeks.map(w => <option key={w} value={w}>сдвинуть на неделю {w}</option>)}
                    <option value="remove">снять у ученика</option>
                  </select>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
