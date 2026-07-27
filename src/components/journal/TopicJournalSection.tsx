import { useMemo, useState } from 'react'
import {
  Loader2, ClipboardList, BarChart3, AlertTriangle, Clock, CheckCircle,
  MessageSquare, RotateCcw,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime } from '@/utils/format'
import { useStudentTopicJournal } from '@/hooks/useStudentTopicJournal'
import {
  filterByCourse, journalCourses, formatHomeworkScore,
  JOURNAL_HW_STATUS_LABEL, JOURNAL_HW_STATUS_TONE,
  JOURNAL_TEST_STATUS_LABEL, JOURNAL_TEST_STATUS_TONE,
  type TopicJournalHomework, type TopicJournalTest,
} from '@/lib/topicJournal'

/**
 * Блок «ДЗ и тесты» журнала ученика — новый контур целиком.
 *
 * Заменил секцию Homework V2 (get_student_homework_journal): в продукте
 * домашние задания существуют только в теме (§9.3), тесты — только через
 * привязку теста из банка к теме (§10.2). Занятия/посещаемость/динамика
 * остаются на старой get_student_journal и здесь не трогаются.
 */
export function TopicJournalSection({ studentId }: { studentId: string }) {
  const { journal, loading, error } = useStudentTopicJournal(studentId)
  const [courseId, setCourseId] = useState<string>('')
  const [tab, setTab] = useState<'homework' | 'tests'>('homework')

  const courses = useMemo(() => (journal ? journalCourses(journal) : []), [journal])
  const view = useMemo(() => (journal ? filterByCourse(journal, courseId || null) : null), [journal, courseId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />Загрузка заданий…
      </div>
    )
  }
  if (error) {
    return <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>
  }
  if (!journal || !view) {
    return (
      <Card>
        <p className="text-sm text-gray-400 py-6 text-center">
          Журнал заданий недоступен для этого ученика.
        </p>
      </Card>
    )
  }

  const s = journal.summary
  const nothing = view.homework.length === 0 && view.tests.length === 0

  return (
    <div className="space-y-4">
      {/* Сводка */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="ДЗ задано"   value={s.hw_total} />
        <SummaryCard label="ДЗ принято"  value={s.hw_accepted} />
        <SummaryCard label="Ждёт сдачи"  value={s.hw_pending} sub={s.hw_overdue > 0 ? `просрочено: ${s.hw_overdue}` : undefined} />
        <SummaryCard label="Тесты"       value={`${s.tests_completed} / ${s.tests_total}`} sub={s.tests_avg_percent != null ? `средний ${s.tests_avg_percent}%` : undefined} />
      </div>

      {(s.avg_score_five != null || s.avg_score_hundred != null) && (
        <Card>
          <div className="text-xs text-gray-500 mb-2">
            Средний балл за принятые ДЗ (по шкалам считается отдельно — 5 и 100 не смешиваются)
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {s.avg_score_five != null && (
              <span className="flex items-center gap-1.5">
                <CheckCircle size={14} className="text-emerald-500" />
                5-балльная: <strong>{s.avg_score_five}</strong>
              </span>
            )}
            {s.avg_score_hundred != null && (
              <span className="flex items-center gap-1.5">
                <CheckCircle size={14} className="text-emerald-500" />
                100-балльная: <strong>{s.avg_score_hundred}</strong>
              </span>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <ClipboardList size={16} className="inline mr-2 text-primary-500" />
            Домашние задания и тесты
          </CardTitle>
          {courses.length > 1 && (
            <select
              value={courseId}
              onChange={e => setCourseId(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">Все курсы</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </CardHeader>

        {/* Переключатель */}
        <div className="flex gap-1 bg-gray-50 rounded-lg p-1 w-fit mb-3">
          {([['homework', `ДЗ (${view.homework.length})`], ['tests', `Тесты (${view.tests.length})`]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
            >
              {label}
            </button>
          ))}
        </div>

        {nothing ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            По открытым темам курса заданий пока нет.
          </p>
        ) : tab === 'homework' ? (
          view.homework.length === 0
            ? <p className="text-sm text-gray-400 py-6 text-center">Домашних заданий нет.</p>
            : <div className="space-y-2">{view.homework.map(h => <HomeworkRow key={h.homework_id} row={h} />)}</div>
        ) : (
          view.tests.length === 0
            ? <p className="text-sm text-gray-400 py-6 text-center">Тестов не привязано.</p>
            : <div className="space-y-2">{view.tests.map(t => <TestRow key={t.assignment_id} row={t} />)}</div>
        )}
      </Card>
    </div>
  )
}

function HomeworkRow({ row }: { row: TopicJournalHomework }) {
  const score = formatHomeworkScore(row)
  return (
    <div
      className={cn('rounded-xl border p-3', row.is_overdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}
      data-testid="journal-homework-row"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-gray-400 truncate">
            {row.course_title}{row.module_title ? ` · ${row.module_title}` : ''} · {row.topic_title}
          </div>
          <div className="text-sm font-semibold text-gray-800">{row.title}</div>
          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mt-1">
            {row.due_at && (
              <span className={cn('flex items-center gap-1', row.is_overdue && 'text-red-500 font-semibold')}>
                <Clock size={11} />
                {row.is_overdue ? 'Просрочено · ' : 'Сдать до '}{formatDate(row.due_at)}
              </span>
            )}
            {row.attempts_count > 0 && (
              <span className="flex items-center gap-1">
                <RotateCcw size={11} />попыток: {row.attempts_count}
              </span>
            )}
            {row.submitted_at && <span>сдано {formatDateTime(row.submitted_at)}</span>}
            {row.reviewed_at && <span>проверено {formatDateTime(row.reviewed_at)}</span>}
          </div>
          {row.comment && (
            <div className="mt-2 flex items-start gap-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
              <MessageSquare size={12} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800 leading-relaxed">{row.comment}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border', JOURNAL_HW_STATUS_TONE[row.status])}>
            {JOURNAL_HW_STATUS_LABEL[row.status]}
          </span>
          {score && <span className="text-sm font-bold text-emerald-700">{score}</span>}
          {row.is_overdue && (
            <span className="flex items-center gap-1 text-[11px] text-red-500">
              <AlertTriangle size={11} />просрочено
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function TestRow({ row }: { row: TopicJournalTest }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3" data-testid="journal-test-row">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-gray-400 truncate">{row.course_title} · {row.topic_title}</div>
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <BarChart3 size={13} className="text-indigo-500" />{row.test_title}
          </div>
          {row.completed_at && (
            <div className="text-xs text-gray-400 mt-1">пройден {formatDateTime(row.completed_at)}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border', JOURNAL_TEST_STATUS_TONE[row.status])}>
            {JOURNAL_TEST_STATUS_LABEL[row.status]}
          </span>
          {row.status === 'completed' && (
            <span className="text-sm font-bold text-indigo-700">
              {row.total_points ?? 0} / {row.max_points ?? 0}
              {row.percent != null ? ` · ${row.percent}%` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
