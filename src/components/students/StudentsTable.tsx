import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { MyStudent } from '@/lib/studentEnrollment'
import { formatRelativeDay, type LastSubmissions, type TelegramFlags } from '@/lib/studentListData'

/**
 * Список учеников строкой на человека вместо сетки карточек.
 *
 * Порядок колонок утверждён владельцем 2026-08-04 и идёт по убыванию
 * важности при беглом просмотре: кто → класс → где учится → жив ли →
 * связь → когда пришёл.
 *
 * У безгруппных вместо прочерка стоит активная подсказка «назначить группу»:
 * на 04.08 без группы 16 учеников из 20, и это не редкий случай, а основная
 * работа в разделе.
 */

interface StudentsTableProps {
  students:        MyStudent[]
  telegramFlags:   TelegramFlags
  lastSubmissions: LastSubmissions
  /** Открыть зачисление в группу для конкретного ученика. */
  onAssignGroup:   (student: MyStudent) => void
}

export function StudentsTable({ students, telegramFlags, lastSubmissions, onAssignGroup }: StudentsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-3 font-medium">Ученик</th>
            <th className="px-3 py-3 font-medium">Класс</th>
            <th className="px-3 py-3 font-medium">Группа · Курс</th>
            <th className="px-3 py-3 font-medium">Последняя сдача</th>
            <th className="px-3 py-3 font-medium text-center">TG</th>
            <th className="px-4 py-3 font-medium">Добавлен</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {students.map(student => (
            <StudentRow
              key={student.studentId ?? student.profileId ?? student.fullName}
              student={student}
              telegram={student.studentId ? telegramFlags[student.studentId] : undefined}
              lastSubmission={student.studentId ? lastSubmissions[student.studentId] : undefined}
              onAssignGroup={onAssignGroup}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StudentRow({
  student, telegram, lastSubmission, onAssignGroup,
}: {
  student:        MyStudent
  telegram:       boolean | undefined
  lastSubmission: string | undefined
  onAssignGroup:  (student: MyStudent) => void
}) {
  const groupNames  = student.groups.map(group => group.name).filter(Boolean)
  const courseNames = student.courses.map(course => course.title).filter(Boolean)
  const hasPlace    = groupNames.length > 0 || courseNames.length > 0

  return (
    <tr className="hover:bg-slate-50/70 transition-colors">
      <td className="px-4 py-3">
        {student.studentId ? (
          <Link
            to={`/students/${student.studentId}`}
            className="font-medium text-graphite-950 hover:text-primary-700"
          >
            {student.fullName}
          </Link>
        ) : (
          <span className="font-medium text-graphite-950">{student.fullName}</span>
        )}
      </td>

      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
        {student.classGrade || '—'}
      </td>

      <td className="px-3 py-3">
        {hasPlace ? (
          <div className="min-w-0">
            <div className="truncate text-graphite-900">{groupNames.join(', ') || '—'}</div>
            {courseNames.length > 0 && (
              <div className="truncate text-xs text-slate-400">{courseNames.join(', ')}</div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onAssignGroup(student)}
            data-testid="assign-group-hint"
            className="text-primary-700 hover:text-primary-800 hover:underline"
          >
            Назначить группу
          </button>
        )}
      </td>

      <td className={cn(
        'px-3 py-3 whitespace-nowrap',
        lastSubmission ? 'text-slate-600' : 'text-slate-400',
      )}>
        {formatRelativeDay(lastSubmission)}
      </td>

      <td className="px-3 py-3 text-center">
        {telegram === undefined ? (
          <span className="text-slate-300">—</span>
        ) : telegram ? (
          <Send size={14} className="inline text-primary-600" aria-label="Telegram привязан" />
        ) : (
          <span className="text-slate-300" aria-label="Telegram не привязан">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
        {student.addedAt
          ? new Date(student.addedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '—'}
      </td>
    </tr>
  )
}
