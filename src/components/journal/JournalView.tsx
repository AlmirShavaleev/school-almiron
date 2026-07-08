import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2, Users, Calendar, CheckCircle, XCircle, Clock, ClipboardList,
  TrendingUp, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/utils/cn'
import { formatDate, formatDateTime } from '@/utils/format'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useStudentJournal, type JournalPeriod } from '@/hooks/useStudentJournal'
import {
  getDisplayHomeworkStatus, isSubmittedOnTime,
  type JournalLesson, type JournalAssignment, type DisplayHomeworkStatus,
} from '@/types/journal'

// ─── Labels ──────────────────────────────────────────────────────────────────

const LESSON_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Запланировано', completed: 'Завершено', cancelled: 'Отменено', missed: 'Пропущено',
}
const ATT_LABELS: Record<string, string> = { present: 'Присутствовал', late: 'Опоздал', absent: 'Отсутствовал', excused: 'Уважительная причина' }
const HW_STATUS_LABELS: Record<DisplayHomeworkStatus, string> = {
  not_started: 'Не начато', submitted: 'На проверке', returned: 'Возвращено', accepted: 'Принято', rejected: 'Отклонено', overdue: 'Просрочено',
}
const HW_STATUS_COLORS: Record<DisplayHomeworkStatus, string> = {
  not_started: 'bg-gray-50 text-gray-500 border-gray-200',
  submitted:   'bg-blue-50 text-blue-600 border-blue-200',
  returned:    'bg-orange-50 text-orange-600 border-orange-200',
  accepted:    'bg-green-50 text-green-600 border-green-200',
  rejected:    'bg-red-50 text-red-600 border-red-200',
  overdue:     'bg-red-50 text-red-600 border-red-200',
}

const PERIODS: { key: JournalPeriod; label: string }[] = [
  { key: '30d', label: '30 дней' }, { key: '90d', label: '90 дней' }, { key: 'all', label: 'Всё время' },
]

// Canonical two-subject domain (matches SUBJECT_LABELS used elsewhere in the app).
// Lessons derive this from their group's course; assignments from the collection.
// Individual lessons without a group have no subject source and are excluded
// from lesson/attendance results whenever a subject filter is active (never guessed).
const SUBJECT_OPTIONS = [
  { value: 'Физика', label: 'Физика' },
  { value: 'Математика', label: 'Математика' },
]

// ─── Props ───────────────────────────────────────────────────────────────────

interface JournalViewProps {
  studentId: string
  viewerRole: 'teacher' | 'student'
  lessonHref: (lessonId: string) => string
  assignmentHref: (a: JournalAssignment) => string | null
}

export function JournalView({ studentId, viewerRole, lessonHref, assignmentHref }: JournalViewProps) {
  const [period, setPeriod] = useState<JournalPeriod>('30d')
  const [subject, setSubject] = useState<string>('')
  const [hwFilter, setHwFilter] = useState<DisplayHomeworkStatus | 'all'>('all')
  const { journal, loading, error } = useStudentJournal(studentId, period, undefined, undefined, subject || null)

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-gray-400 gap-2"><Loader2 size={20} className="animate-spin" />Загрузка журнала…</div>
  }
  if (error) {
    return <div className="text-center py-16 text-red-500"><AlertTriangle size={32} className="mx-auto mb-2 opacity-50" />{error}</div>
  }
  if (!journal) return null

  const { student, summary, lessons, assignments, trend } = journal

  const filteredAssignments = hwFilter === 'all'
    ? assignments
    : assignments.filter(a => getDisplayHomeworkStatus(a) === hwFilter)

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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Занятий завершено" value={summary.lessons_completed} />
        {summary.attendance_pct != null
          ? <SummaryCard label="Посещаемость" value={`${summary.attendance_pct}%`} sub={`${summary.attended} из ${summary.attended + summary.missed}`} />
          : <SummaryCard label="Посещаемость" value="—" sub="недостаточно данных" muted />}
        <SummaryCard label="ДЗ назначено" value={summary.hw_assigned} />
        <SummaryCard label="ДЗ принято" value={summary.hw_accepted} />
        <SummaryCard label="ДЗ возвращено" value={summary.hw_returned} />
        <SummaryCard label="ДЗ просрочено" value={summary.hw_overdue} warn={summary.hw_overdue > 0} />
        {summary.scored_count > 0
          ? <SummaryCard label="Средний балл" value={summary.avg_score!} sub={`сырой, по ${summary.scored_count} оценённым раб.`} />
          : <SummaryCard label="Средний балл" value="—" sub="нет оценённых работ" muted />}
        <SummaryCard label="Вовремя сдано" value={summary.hw_with_due_date > 0 ? `${summary.hw_on_time} из ${summary.hw_with_due_date}` : '—'} muted={summary.hw_with_due_date === 0} />
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

      {/* Basic progress plain-text block */}
      <Card>
        <div className="text-sm text-gray-600 leading-relaxed">
          {summary.attendance_pct != null && <>Посещаемость: <strong>{summary.attendance_pct}%</strong> ({summary.attended} из {summary.attended + summary.missed}). </>}
          {summary.hw_with_due_date > 0 && <>Вовремя сдано: <strong>{summary.hw_on_time} из {summary.hw_with_due_date}</strong>. </>}
          Принято работ: <strong>{summary.hw_accepted}</strong>. Возвращено: <strong>{summary.hw_returned}</strong>.
          {summary.scored_count > 0 && <> Средний сырой балл по оценённым работам: <strong>{summary.avg_score}</strong> (по {summary.scored_count} раб.).</>}
        </div>
      </Card>

      {/* Trend chart */}
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
              <Bar dataKey="submitted" name="Сдано ДЗ" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="accepted" name="Принято ДЗ" fill="#22c55e" radius={[3, 3, 0, 0]} />
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

      {/* Homework table */}
      <Card>
        <CardHeader>
          <CardTitle><ClipboardList size={16} className="inline mr-2 text-primary-500" />Домашние задания</CardTitle>
          <select
            value={hwFilter}
            onChange={e => setHwFilter(e.target.value as DisplayHomeworkStatus | 'all')}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
          >
            <option value="all">Все</option>
            {(Object.keys(HW_STATUS_LABELS) as DisplayHomeworkStatus[]).map(k => (
              <option key={k} value={k}>{HW_STATUS_LABELS[k]}</option>
            ))}
          </select>
        </CardHeader>
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {assignments.length === 0 ? 'Домашних заданий пока нет' : 'Нет заданий с этим статусом'}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAssignments.map(a => (
              <AssignmentRow key={`${a.source}:${a.assigned_id}`} assignment={a} href={assignmentHref(a)} />
            ))}
          </div>
        )}
      </Card>
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

function AssignmentRow({ assignment, href }: { assignment: JournalAssignment; href: string | null }) {
  const status = getDisplayHomeworkStatus(assignment)
  const onTime = isSubmittedOnTime(assignment)

  const inner = (
    <>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-800 truncate">{assignment.collection_title || 'Задание'}</div>
        <div className="text-xs text-gray-400 flex items-center gap-2">
          {assignment.due_date && <span>до {formatDate(assignment.due_date)}</span>}
          {assignment.submitted_at && onTime === false && <span className="text-orange-500">сдано с опозданием</span>}
          {assignment.score != null && <span>балл: {assignment.score}</span>}
        </div>
      </div>
      <span className={cn('text-xs px-2 py-0.5 rounded-full border shrink-0', HW_STATUS_COLORS[status])}>
        {HW_STATUS_LABELS[status]}
      </span>
      {href && <ExternalLink size={13} className="text-gray-300 group-hover:text-gray-500 shrink-0" />}
    </>
  )

  if (href) {
    return <Link to={href} className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors group hover:bg-gray-50">{inner}</Link>
  }
  return <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors group">{inner}</div>
}
