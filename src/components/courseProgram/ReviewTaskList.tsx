import { ClipboardList } from 'lucide-react'
import {
  REVIEW_TASK_VERDICT_LABEL,
  sortReviewTasks,
  type ReviewTaskRow,
} from '@/lib/homeworkReviewTasks'
import { expectedOnlyView, notesOfTask, orphanNotes, type ReviewNote } from '@/lib/reviewNotes'
import { cn } from '@/utils/cn'
import { MARK_OF_REVIEW_VERDICT, VerdictMark } from '@/components/ui/VerdictMark'

/**
 * «По заданиям» глазами ученика (§199).
 *
 * Решение владельца: таблицу после проверки видит ученик. До проверки — нет, и
 * это держит политика (`topic_homework_review_tasks_student_select`: свои
 * строки и только при наличии вердикта), а не этот компонент.
 *
 * §209. Здесь два правила, которые легко потерять при слиянии списков.
 *
 * 1. **Замечания — те же, что у преподавателя.** С §209 замечание это рамка
 *    на работе, привязанная к заданию, а не поле `note`. Если бы этот блок
 *    продолжал показывать только `note`, ученик перестал бы видеть всё, что
 *    преподаватель написал после §209, — и узнал бы об этом не он, а никто.
 *    Старое поле `note` показывается по-прежнему: у сотен работ это
 *    единственный текст проверки.
 * 2. **Своего ответа ученик не видит.** ИИ читает почерк с ошибками, и
 *    «твой ответ: 0,375», когда он написал другое, — спор на ровном месте.
 *    Ученику остаются номер, итог, правильный ответ и замечания.
 */
export function ReviewTaskList({
  rows,
  notes = [],
  className,
}: {
  rows: readonly ReviewTaskRow[]
  /** §209. Замечания-рамки этой попытки (опубликованные). */
  notes?: readonly ReviewNote[]
  className?: string
}) {
  if (rows.length === 0 && notes.length === 0) return null
  const ordered = sortReviewTasks(rows)
  const orphans = orphanNotes(notes, ordered)

  return (
    <section
      data-testid="student-review-tasks"
      className={cn('rounded-xl border border-gray-200 bg-white p-3', className)}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <ClipboardList size={13} className="text-gray-400" />
        По заданиям
      </div>

      <ul className="mt-1 divide-y divide-gray-100">
        {ordered.map(row => {
          const own = notesOfTask(notes, row.no)
          const legacy = String(row.note ?? '').trim()
          return (
            <li key={row.id} data-testid="student-review-task-row" data-no={row.no} data-verdict={row.verdict}>
              <div className="flex items-start gap-2 py-1.5">
                {/* §225. Метка состояния v2: форма + цвет, в печати — форма.
                    «Не решено» (пустой круг) и «не сверено» (синий пунктир с
                    вопросом) различаются на глаз, как требовал §214. */}
                <VerdictMark
                  state={MARK_OF_REVIEW_VERDICT[row.verdict]}
                  size={14}
                  label={REVIEW_TASK_VERDICT_LABEL[row.verdict]}
                  className="mt-0.5"
                />
                <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-gray-600">{row.no}</span>
                <span
                  data-testid="student-review-task-answer"
                  className="min-w-0 flex-1 break-words text-[11px] leading-5 text-gray-700"
                >
                  {expectedOnlyView(row.expected_answer)}
                </span>
              </div>
              {(own.length > 0 || legacy) && (
                <ul className="pb-1.5 pl-11">
                  {own.map(note => (
                    <li key={note.id} data-testid="student-review-task-note" className="text-[11px] leading-5 text-gray-600">
                      {note.text}
                      {note.page != null && <span className="ml-1 text-[10px] text-gray-400">стр. {note.page}</span>}
                    </li>
                  ))}
                  {legacy && (
                    <li data-testid="student-review-task-note" className="text-[11px] leading-5 text-gray-600">{legacy}</li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {/* Замечание, не привязанное ни к одному заданию, тоже адресовано
          ученику — молчать о нём нельзя. */}
      {orphans.length > 0 && (
        <div data-testid="student-review-orphan-notes" className="mt-2 border-t border-gray-100 pt-2">
          <ul>
            {orphans.map(note => (
              <li key={note.id} data-testid="student-review-task-note" className="text-[11px] leading-5 text-gray-600">
                {note.text}
                {note.page != null && <span className="ml-1 text-[10px] text-gray-400">стр. {note.page}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
