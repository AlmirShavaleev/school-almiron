import { useMemo, useState } from 'react'
import { ClipboardList, Loader2, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime } from '@/utils/format'
import { useStudentHomeworkJournal, type StudentHomeworkJournalRow } from '@/hooks/useStudentHomeworkJournal'
import { useHomeworkAttemptHistory } from '@/hooks/useHomeworkAttemptHistory'
import { HW_V2_CATEGORY_LABELS, type HomeworkV2Category } from '@/types/homeworkV2'

const TABS: HomeworkV2Category[] = ['new', 'to_do', 'under_review', 'returned_for_revision', 'checked']

const CATEGORY_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600 border-blue-200',
  to_do: 'bg-orange-50 text-orange-600 border-orange-200',
  under_review: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  returned_for_revision: 'bg-red-50 text-red-600 border-red-200',
  checked: 'bg-green-50 text-green-600 border-green-200',
}

/** Homework V2 block of the student journal — replaces the legacy homeworks/task_collections
 * assignment table entirely. Source: get_student_homework_journal(p_student_id), RLS-scoped to
 * groups the calling teacher actually teaches (or admin/owner) — never another teacher's
 * assignments for the same student. */
export function HomeworkV2JournalSection({ studentId }: { studentId: string }) {
  const { rows, loading, error } = useStudentHomeworkJournal(studentId)
  const [tab, setTab] = useState<HomeworkV2Category | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.ui_category] = (c[r.ui_category] || 0) + 1
    return c
  }, [rows])

  const overdueCount = rows.filter(r => r.is_overdue).length

  // Average score is shown only when it is unambiguous: accepted attempts with a numeric score.
  const acceptedScored = rows.filter(r => r.latest_review_decision === 'accepted' && r.latest_score != null)
  const avgScore = acceptedScored.length > 0
    ? Math.round((acceptedScored.reduce((sum, r) => sum + (r.latest_score || 0), 0) / acceptedScored.length) * 10) / 10
    : null

  const visible = tab === 'all' ? rows : rows.filter(r => r.ui_category === tab)

  if (loading) {
    return <div className="flex items-center justify-center h-32 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" />Загрузка Homework V2…</div>
  }
  if (error) {
    return <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Всего назначено" value={rows.length} />
        <SummaryCard label="Нужно сдать" value={(counts.new || 0) + (counts.to_do || 0)} />
        <SummaryCard label="На проверке" value={counts.under_review || 0} />
        <SummaryCard label="На доработке" value={counts.returned_for_revision || 0} />
        <SummaryCard label="Проверено" value={counts.checked || 0} />
        <SummaryCard label="Просрочено" value={overdueCount} warn={overdueCount > 0} />
        {avgScore != null
          ? <SummaryCard label="Средний балл" value={avgScore} sub={`по ${acceptedScored.length} принятым`} />
          : <SummaryCard label="Средний балл" value="—" sub="нет принятых с оценкой" muted />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle><ClipboardList size={16} className="inline mr-2 text-primary-500" />Домашние задания (Homework V2)</CardTitle>
          <select value={tab} onChange={e => setTab(e.target.value as HomeworkV2Category | 'all')} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="all">Все</option>
            {TABS.map(t => <option key={t} value={t}>{HW_V2_CATEGORY_LABELS[t]}</option>)}
          </select>
        </CardHeader>

        {visible.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {rows.length === 0 ? 'Homework V2 заданий пока нет' : 'Нет заданий с этим статусом'}
          </div>
        ) : (
          <div className="space-y-1">
            {visible.map(row => (
              <JournalRow
                key={row.assignment_id}
                row={row}
                studentId={studentId}
                expanded={expanded === row.assignment_id}
                onToggle={() => setExpanded(e => e === row.assignment_id ? null : row.assignment_id)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, sub, muted, warn }: { label: string; value: string | number; sub?: string; muted?: boolean; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl p-3.5', warn ? 'bg-red-50' : 'bg-gray-50')}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={cn('text-xl font-bold', muted ? 'text-gray-300' : warn ? 'text-red-600' : 'text-gray-900')}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function JournalRow({ row, studentId, expanded, onToggle }: { row: StudentHomeworkJournalRow; studentId: string; expanded: boolean; onToggle: () => void }) {
  const { attempts, loading } = useHomeworkAttemptHistory(expanded ? row.assignment_id : null, studentId)

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 py-2.5 px-3 hover:bg-gray-50 transition-colors group text-left">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-800 truncate">{row.title}</div>
          <div className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
            <span>{row.course_title}</span>
            <span>· {row.group_title}</span>
            {row.effective_due_at && <span>· до {formatDate(row.effective_due_at)}</span>}
            {row.latest_attempt_number != null && <span>· попытка {row.latest_attempt_number}</span>}
            {row.latest_score != null && <span>· балл: {row.latest_score}</span>}
          </div>
        </div>
        <span className={cn('text-xs px-2 py-0.5 rounded-full border shrink-0', CATEGORY_COLORS[row.ui_category] || 'bg-gray-50 text-gray-500 border-gray-200')}>
          {HW_V2_CATEGORY_LABELS[row.ui_category as HomeworkV2Category] || row.ui_category}
        </span>
        {row.is_overdue && <span className="text-xs px-2 py-0.5 rounded-full border shrink-0 bg-red-50 text-red-600 border-red-200">Просрочено</span>}
        {expanded ? <ChevronUp size={14} className="text-gray-300 shrink-0" /> : <ChevronDown size={14} className="text-gray-300 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-3 space-y-3">
          {row.latest_review_comment && (
            <div className="text-xs text-blue-800 bg-blue-50 rounded-lg p-2">
              <strong>Комментарий преподавателя:</strong> {row.latest_review_comment}
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={14} className="animate-spin" />Загрузка истории попыток…</div>
          ) : attempts.length === 0 ? (
            <p className="text-xs text-gray-400">Попыток пока не было</p>
          ) : (
            <div className="space-y-2">
              {attempts.map(a => (
                <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Попытка {a.attempt_number}</span>
                    <span className="text-gray-400">{a.submitted_at ? formatDateTime(a.submitted_at) : a.status}</span>
                  </div>
                  {a.answer_text && <div className="text-gray-600 truncate">{a.answer_text}</div>}
                  {a.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {a.files.map(f => (
                        <span key={f.id} className="flex items-center gap-1 text-gray-500 bg-gray-50 rounded px-1.5 py-0.5"><FileText size={11} />{f.file_name}</span>
                      ))}
                    </div>
                  )}
                  {a.reviews.map(r => (
                    <div key={r.id} className="mt-1 pt-1 border-t border-gray-100 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-medium">{r.decision}</span>
                        {r.comment && <span className="text-gray-500"> — {r.comment}</span>}
                        {r.reviewer_name && <span className="text-gray-400"> ({r.reviewer_name})</span>}
                      </div>
                      <span className="text-gray-400 shrink-0">{r.score != null ? `${r.score} б.` : ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
