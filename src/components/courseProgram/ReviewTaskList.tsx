import { ClipboardList } from 'lucide-react'
import { ReadOnlyTaskLine } from './ReviewTaskTable'
import { sortReviewTasks, type ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import { cn } from '@/utils/cn'

/**
 * «По заданиям» глазами ученика (§199).
 *
 * Решение владельца: таблицу после проверки видит ученик. До проверки — нет, и
 * это держит политика (`topic_homework_review_tasks_student_select`: свои
 * строки и только при наличии вердикта), а не этот компонент: строк просто не
 * приходит. Компонент лишь честно молчит, когда их нет, — у старых работ и у
 * работ без ИИ-проверки таблицы не будет, и экран должен выглядеть как раньше.
 *
 * Разметка — та же, что в панели преподавателя (`ReadOnlyTaskLine`): на широком
 * экране строки укладываются в столбцы, на телефоне складываются в карточку.
 * Второй, «мобильной» копии нет намеренно (§186).
 */
export function ReviewTaskList({
  rows,
  className,
}: {
  rows: readonly ReviewTaskRow[]
  className?: string
}) {
  if (rows.length === 0) return null
  const ordered = sortReviewTasks(rows)

  return (
    <section
      data-testid="student-review-tasks"
      className={cn('rounded-xl border border-gray-200 bg-white p-3', className)}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <ClipboardList size={13} className="text-gray-400" />
        По заданиям
      </div>

      {/* Шапка столбцов — только там, где строка в столбцы укладывается. */}
      <div className="mt-2 hidden px-1 text-[10px] uppercase tracking-wide text-gray-400 sm:grid sm:grid-cols-[2.5rem_7.5rem_minmax(0,1fr)_minmax(0,1.2fr)_1.75rem] sm:gap-2">
        <span>№</span>
        <span>Итог</span>
        <span>Твой ответ → правильный</span>
        <span>Замечание</span>
        <span />
      </div>

      <ul className="mt-1 divide-y divide-gray-100">
        {ordered.map(row => (
          <ReadOnlyTaskLine
            key={row.id}
            testId="student-review-task-row"
            task={{
              no: row.no,
              verdict: row.verdict,
              student_answer: row.student_answer ?? '',
              expected_answer: row.expected_answer ?? '',
              note: row.note ?? '',
            }}
          />
        ))}
      </ul>
    </section>
  )
}
