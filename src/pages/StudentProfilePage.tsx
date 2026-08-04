import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, CheckCircle, Clock, X as XIcon,
  Star, TrendingUp,
  Mail, Phone, Loader2, ChevronDown, ChevronUp, CreditCard, RefreshCw, AlertCircle,
} from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { useStudentNumberStats } from '@/hooks/useStudentNumberStats'
import { useStudentCourseMemberships } from '@/hooks/useStudentCourseMemberships'
import { useGroups } from '@/hooks/useGroups'
import { StudentNumberStatsSection } from '@/components/student/StudentNumberStatsSection'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { HW_STATUS_LABELS, HW_STATUS_COLORS } from '@/utils/format'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'
import { Plus, BookOpen, Calendar } from 'lucide-react'

// ─── Attendance ring ──────────────────────────────────────────────────────────
function Ring({ value, color, size = 80 }: { value: number; color: string; size?: number }) {
  const r  = size / 2 - 8
  const c  = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="7" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
    </svg>
  )
}

// ─── HW status badge ──────────────────────────────────────────────────────────
function HwStatus({ status }: { status: string }) {
  return (
    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', HW_STATUS_COLORS[status] || 'bg-gray-100 text-gray-500')}>
      {HW_STATUS_LABELS[status] || status}
    </span>
  )
}

// ─── Attendance status icon ───────────────────────────────────────────────────
function AttStatus({ status }: { status: string }) {
  if (status === 'present') return <CheckCircle size={14} className="text-green-500 shrink-0" />
  if (status === 'absent')  return <XIcon size={14} className="text-red-500 shrink-0" />
  if (status === 'late')    return <Clock size={14} className="text-orange-400 shrink-0" />
  return null
}

// ─── Section toggle ───────────────────────────────────────────────────────────
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          {title}
          {count !== undefined && (
            <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function StudentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: s, loading } = useStudentProfile(id || null)
  const currentUserRole = useAuthStore(state => state.profile?.role)
  const [groupsExpanded, setGroupsExpanded] = useState(false)
  const numberStats = useStudentNumberStats(
    s?.student_id ?? null,
    s?.target_subject ?? null,
    s?.target_exam ?? null,
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  if (!s) return (
    <div className="text-center py-20 text-gray-400">
      <Users size={40} className="mx-auto mb-3 opacity-30" />
      <p>Студент не найден</p>
    </div>
  )

  const attColor = s.attendance_percent >= 80 ? '#22c55e' : s.attendance_percent >= 60 ? '#eab308' : '#ef4444'

  // Chart data for mock exams
  const chartData = s.mock_results.slice().reverse().map(m => ({
    name: new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    score: Math.round(m.score / m.max_score * 100),
  }))

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Back */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={16} />Назад
        </button>
        {s.student_id && (
          <button
            onClick={() => navigate(`/students/${s.student_id}/journal`)}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            Журнал ученика
          </button>
        )}
      </div>

      {/* Profile header */}
      <Card className="overflow-hidden relative">
        <div className="absolute inset-y-0 right-0 w-64 bg-gradient-to-l from-primary-50/80 to-transparent pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-lg bg-primary-950 flex items-center justify-center text-white font-bold text-2xl shrink-0 overflow-hidden shadow-lg shadow-primary-950/15">
            {s.avatar_url
              ? <img src={s.avatar_url} className="w-full h-full object-cover" />
              : s.full_name.charAt(0)
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-graphite-950">{s.full_name}</h1>
              {s.target_score && (
                <span className="flex items-center gap-1 rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-800 ring-1 ring-gold-100">
                  <Star size={12} />Цель: {s.target_score}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
              <span className="flex items-center gap-1.5"><Mail size={13} />{s.email}</span>
              {s.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{s.phone}</span>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {s.groups.length <= 1 ? (
                s.groups.map(g => (
                  <span key={g.id} className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full">
                    <Users size={11} />{g.name}
                    <span className="text-primary-400">· {g.course_title}</span>
                  </span>
                ))
              ) : (
                <>
                  <button
                    onClick={() => setGroupsExpanded(v => !v)}
                    className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full hover:bg-primary-100"
                  >
                    <Users size={11} />
                    {new Set(s.groups.map(g => g.course_title)).size} курс{new Set(s.groups.map(g => g.course_title)).size === 1 ? '' : 'а'} · {s.groups.length} групп{s.groups.length === 1 ? 'а' : 'ы'}
                    {groupsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {groupsExpanded && s.groups.map(g => (
                    <span key={g.id} className="flex items-center gap-1.5 text-xs bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">
                      <Users size={11} />{g.name}
                      <span className="text-slate-400">· {g.course_title}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-72">
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <div className="text-xs text-slate-500">Посещаемость</div>
              <div className="font-semibold text-graphite-950">{s.attendance_percent}%</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <div className="text-xs text-slate-500">ДЗ</div>
              <div className="font-semibold text-graphite-950">{s.hw_checked}/{s.hw_total}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
              <div className="text-xs text-slate-500">Пробники</div>
              <div className="font-semibold text-graphite-950">{s.mock_count}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Attendance ring */}
        <Card className="flex flex-col items-center justify-center py-4 gap-2">
          <div className="relative">
            <Ring value={s.attendance_percent} color={attColor} />
            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-800">
              {s.attendance_percent}%
            </div>
          </div>
          <div className="text-xs text-center text-gray-500 font-medium">Посещаемость</div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="text-green-500">присутствовал: {s.attendance_present}</span>
            <span className="text-orange-400">опоздал: {s.attendance_late}</span>
            <span className="text-red-400">нет: {s.attendance_absent}</span>
          </div>
        </Card>

        <StatCard
          title="ДЗ сдано"
          value={`${s.hw_checked}/${s.hw_total}`}
          icon={<CheckCircle size={20} />}
          color="green"
        />
        <StatCard
          title="Средний балл ДЗ"
          value={s.hw_avg_score != null ? `${s.hw_avg_score}%` : '—'}
          icon={<TrendingUp size={20} />}
          color="blue"
        />
        <StatCard
          title="Пробников"
          value={s.mock_count}
          icon={<Star size={20} />}
          color="purple"
        />
      </div>

      {/* Mock exam chart */}
      {chartData.length >= 2 && (
        <Card>
          <div className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-primary-500" />
            Динамика пробников
            {s.mock_avg != null && (
              <span className="ml-auto text-sm font-normal text-gray-400">
                Среднее: <span className="font-semibold text-gray-700">{s.mock_avg}%</span>
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip formatter={(v: any) => [`${v}%`, 'Балл']} />
              <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Homeworks */}
      <Section title="Домашние задания" count={s.hw_total}>
        {s.homeworks.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">Нет заданий</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {s.homeworks.map(hw => (
              <div key={hw.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{hw.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {hw.group_name} · до {new Date(hw.due_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </div>
                  {hw.feedback && (
                    <div className="text-xs text-primary-600 mt-1 italic">{hw.feedback}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hw.status === 'checked' && hw.score != null && (
                    <span className={cn(
                      'text-sm font-bold',
                      hw.score / hw.max_score >= 0.8 ? 'text-green-600' :
                      hw.score / hw.max_score >= 0.5 ? 'text-yellow-600' : 'text-red-500'
                    )}>
                      {hw.score}/{hw.max_score}
                    </span>
                  )}
                  <HwStatus status={hw.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent attendance */}
      <Section title="Посещаемость (последние занятия)" count={s.recent_attendance.length}>
        {s.recent_attendance.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">Нет данных</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {s.recent_attendance.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <AttStatus status={a.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{a.lesson_title}</div>
                  {a.note && <div className="text-xs text-gray-400 italic">{a.note}</div>}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(a.scheduled_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Mock results */}
      {s.mock_results.length > 0 && (
        <Section title="Пробные экзамены" count={s.mock_results.length}>
          <div className="divide-y divide-gray-50">
            {s.mock_results.map(m => {
              const pct = Math.round(m.score / m.max_score * 100)
              return (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{m.title}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400')}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className={cn('text-sm font-bold', pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500')}>
                      {m.score}/{m.max_score}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Enrolled courses */}
      {s.student_id && (
        <EnrolledCoursesSection studentId={s.student_id} studentFullName={s.full_name} currentRole={currentUserRole} />
      )}

      {s.student_id && s.target_subject && s.target_exam && (
        <StudentNumberStatsSection
          rows={numberStats.rows}
          loading={numberStats.loading}
          error={numberStats.error}
        />
      )}

    </div>
  )
}

// ── Enrolled courses section ───────────────────────────────────────────────
// Source of truth: group_students -> groups -> courses (real access). Deliberately not
// student_courses -- that table is legacy and disconnected from actual course access, which
// is exactly the bug this section fixes (header badge showed real groups, this block showed
// "not enrolled" from an unrelated table).
function EnrolledCoursesSection({ studentId, studentFullName, currentRole }: { studentId: string; studentFullName: string; currentRole: string | undefined }) {
  const { courses, loading, reload } = useStudentCourseMemberships(studentId)
  const { groups: teacherGroups } = useGroups()
  const [wizardOpen, setWizardOpen] = useState(false)
  const canManage = currentRole === 'admin' || currentRole === 'owner' || currentRole === 'curator' || currentRole === 'teacher'

  const GROUP_TYPE_LABELS: Record<string, string> = {
    individual: 'Индивидуально',
    pair: 'Пара',
    group: 'Мини-группа',
  }

  const distributeGroups: DistributeGroupOption[] = useMemo(
    () => teacherGroups.map((group: any) => ({
      id: group.id,
      name: group.name,
      courseId: group.course_id ?? null,
      isActive: Boolean(group.is_active),
      maxStudents: group.max_students ?? 0,
      studentCount: group.student_count ?? 0,
      memberStudentIds: (group.group_students ?? []).map((gs: any) => gs.student_id),
      scheduleDays: group.schedule_days ?? null,
      scheduleTime: group.schedule_time ?? null,
    })),
    [teacherGroups],
  )

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900">Курсы ученика</h3>
          {courses.length > 0 && (
            <span className="text-xs text-gray-400">({courses.length})</span>
          )}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus size={13} className="mr-1" />Распределить
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" />Загрузка…
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center py-10 gap-2 text-center">
          <BookOpen size={32} className="text-gray-200" />
          <p className="text-sm text-gray-400">Ученик не записан ни на один курс</p>
          {canManage && (
            <button onClick={() => setWizardOpen(true)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              Распределить на курс
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {courses.map(c => (
            <div key={c.courseId} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
              <div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <BookOpen size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900 truncate">{c.courseTitle}</span>
                <div className="text-xs text-gray-500 mt-0.5">
                  {c.courseSubject === 'physics' ? 'Физика' : c.courseSubject === 'math' ? 'Математика' : c.courseSubject}
                  {c.courseExamType && ` · ${c.courseExamType.toUpperCase()}`}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.groups.map(g => (
                    <span key={g.groupId} className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-700 border border-primary-100 px-2 py-0.5 rounded-full">
                      {g.groupName}
                      <span className="text-primary-400">· {GROUP_TYPE_LABELS[g.groupType] || g.groupType}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <DistributeJoinRequestWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          studentId={studentId}
          studentFullName={studentFullName}
          groups={distributeGroups}
          onDistributed={reload}
        />
      )}
    </Card>
  )
}
