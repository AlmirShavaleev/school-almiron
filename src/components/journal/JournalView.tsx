import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2, Users, Calendar, CheckCircle, XCircle, Clock,
  TrendingUp, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useStudentJournal, type JournalPeriod } from '@/hooks/useStudentJournal'
import { HomeworkV2JournalSection } from '@/components/journal/HomeworkV2JournalSection'
import type { JournalLesson } from '@/types/journal'

// ─── Labels ──────────────────────────────────────────────────────────────────

const LESSON_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Запланировано', completed: 'Завершено', cancelled: 'Отменено', missed: 'Пропущено',
}

const PERIODS: { key: JournalPeriod; label: string }[] = [
  { key: '30d', label: '30 дней' }, { key: '90d', label: '90 дней' }, { key: 'all', label: 'Всё время' },
]

// Canonical two-subject domain (matches SUBJECT_LABELS used elsewhere in the app).
// Lessons derive this from their group's course. Individual lessons without a group have no
// subject source and are excluded from lesson/attendance results whenever a subject filter is
// active (never guessed).
const SUBJECT_OPTIONS = [
  { value: 'Физика', label: 'Физика' },
  { value: 'Математика', label: 'Математика' },
]

// ─── Props ───────────────────────────────────────────────────────────────────

interface JournalViewProps {
  studentId: string
  viewerRole: 'teacher' | 'student'
  lessonHref: (lessonId: string) => string
}

/** Lessons/attendance/trend still come from get_student_journal (untouched — those blocks
 * already work correctly). The homework section is Homework V2 only (HomeworkV2JournalSection,
 * sourced from get_student_homework_journal) — legacy homeworks/task_submissions assignment
 * data and the source:'legacy'|'collection' toggle have been removed from this view entirely. */
export function JournalView({ studentId, viewerRole: _viewerRole, lessonHref }: JournalViewProps) {
  const [period, setPeriod] = useState<JournalPeriod>('30d')
  const [subject, setSubject] = useState<string>('')
  const { journal, loading, error } = useStudentJournal(studentId, period, undefined, undefined, subject || null)

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-gray-400 gap-2"><Loader2 size={20} className="animate-spin" />Загрузка журнала…</div>
  }
  if (error) {
    return <div className="text-center py-16 text-red-500"><AlertTriangle size={32} className="mx-auto mb-2 opacity-50" />{error}</div>
  }
  if (!journal) return null

  const { student, summary, lessons, trend } = journal
  const trendHasData = trend.some(w => w.lessons_completed > 0 || w.submitted > 0 || w.accepted > 0)

  return (
    <div className="space-y-6">

      {/* Header + period filter */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{student.full_name}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {student.groups.map(g => (
                <span key={g.group_id} className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full">
                  <Users size={11} />{g.group_name}
                </span>
              ))}
              {student.groups.length === 0 && <span className="text-xs text-gray-400">Не состоит в группе</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="">Все предметы</option>
              {SUBJECT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="flex gap-1 bg-gray-50 rounded-lg p-1">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {subject && <p className="text-xs text-gray-400 mt-2">Занятия без определённого предмета (индивидуальные, вне группы/курса) скрыты при выбранном фильтре.</p>}
      </Card>

      {/* Attendance summary — unchanged, still from get_student_journal */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Занятий завершено" value={summary.lessons_completed} />
        {summary.attendance_pct != null
          ? <SummaryCard label="Посещаемость" value={`${summary.attendance_pct}%`} sub={`${summary.attended} из ${summary.attended + summary.missed}`} />
          : <SummaryCard label="Посещаемость" value="—" sub="недостаточно данных" muted />}
      </div>

      {/* Attendance breakdown — present/late/absent/excused shown separately */}
      {summary.lessons_completed > 0 && (
        <Card>
          <div className="text-xs text-gray-500 mb-2">Детализация посещаемости (excused не входит в расчёт %)</div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-green-500" />Присутствовал: <strong>{summary.present_count}</strong></span>
            <span className="flex items-center gap-1.5"><Clock size={14} className="text-orange-400" />Опоздал: <strong>{summary.late_count}</strong></span>
            <span className="flex items-center gap-1.5"><XCircle size={14} className="text-red-500" />Отсутствовал: <strong>{summary.absent_count}</strong></span>
            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-blue-400" />Уважительная причина: <strong>{summary.excused_count}</strong></span>
          </div>
        </Card>
      )}

      {/* Trend chart — lessons_completed unchanged; submitted/accepted still legacy-sourced
          (get_student_journal), left as-is per "не меняй занятия/посещаемость" scope. */}
      <Card>
        <CardHeader><CardTitle><TrendingUp size={16} className="inline mr-2 text-primary-500" />Динамика по неделям</CardTitle></CardHeader>
        {trendHasData ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trend.map(w => ({ ...w, name: formatDate(w.week_start) }))} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="lessons_completed" name="Занятий" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-10 text-sm text-gray-400">Пока недостаточно данных для отображения динамики</div>
        )}
      </Card>

      {/* Lessons table */}
      <Card>
        <CardHeader><CardTitle><Calendar size={16} className="inline mr-2 text-primary-500" />Занятия</CardTitle></CardHeader>
        {lessons.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">Занятий в этом периоде нет</div>
        ) : (
          <div className="space-y-1">
            {lessons.map(l => <LessonRow key={l.id} lesson={l} href={lessonHref(l.id)} />)}
          </div>
        )}
      </Card>

      {/* Homework — Homework V2 only */}
      <HomeworkV2JournalSection studentId={studentId} />
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, muted, warn }: { label: string; value: string | number; sub?: string; muted?: boolean; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl p-3.5', warn ? 'bg-red-50' : 'bg-gray-50')}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={cn('text-xl font-bold', muted ? 'text-gray-300' : warn ? 'text-red-600' : 'text-gray-900')}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function LessonRow({ lesson, href }: { lesson: JournalLesson; href: string }) {
  const attIcon = lesson.attendance_status === 'present' ? <CheckCircle size={14} className="text-green-500" />
    : lesson.attendance_status === 'absent' ? <XCircle size={14} className="text-red-500" />
    : lesson.attendance_status === 'late' ? <Clock size={14} className="text-orange-400" />
    : lesson.attendance_status === 'excused' ? <CheckCircle size={14} className="text-blue-400" />
    : null

  return (
    <Link to={href} className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors group">
      {attIcon}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-800 truncate flex items-center gap-2">
          {lesson.title}
          {lesson.group_name && <span className="text-xs text-gray-400">· {lesson.group_name}</span>}
        </div>
        {(lesson.actual_topic || lesson.planned_topic) && (
          <div className="text-xs text-gray-400 truncate">{lesson.actual_topic || lesson.planned_topic}</div>
        )}
      </div>
      <span className={cn('text-xs px-2 py-0.5 rounded-full border shrink-0',
        lesson.status === 'completed' ? 'bg-green-50 text-green-600 border-green-200'
        : lesson.status === 'cancelled' ? 'bg-gray-50 text-gray-400 border-gray-200'
        : lesson.status === 'scheduled' ? 'bg-blue-50 text-blue-600 border-blue-200'
        : 'bg-red-50 text-red-600 border-red-200')}>
        {LESSON_STATUS_LABELS[lesson.status] || lesson.status}
      </span>
      <span className="text-xs text-gray-400 shrink-0 w-20 text-right">{formatDate(lesson.scheduled_at)}</span>
      <ExternalLink size={13} className="text-gray-300 group-hover:text-gray-500 shrink-0" />
    </Link>
  )
}
