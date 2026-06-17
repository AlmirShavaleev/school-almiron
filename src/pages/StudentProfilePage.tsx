import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, CheckCircle, Clock, X as XIcon,
  Star, TrendingUp,
  Mail, Phone, Loader2, ChevronDown, ChevronUp, CreditCard, RefreshCw, AlertCircle,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { HW_STATUS_LABELS, HW_STATUS_COLORS } from '@/utils/format'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'
import type { Subscription } from '@/hooks/useSubscription'
import { useAuthStore } from '@/store/authStore'
import { useStudentCourses } from '@/hooks/useStudentCourses'
import { EnrollCourseModal } from '@/components/modals/EnrollCourseModal'
import { Plus, BookOpen, Calendar, Trash2 } from 'lucide-react'

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

  // Subscription for this student (fetched directly, since we're viewing as teacher/admin)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [subLoading,   setSubLoading]   = useState(false)

  useEffect(() => {
    if (!s?.student_id) return
    setSubLoading(true)
    supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('student_id', s.student_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { setSubscription((data || null) as any); setSubLoading(false) })
  }, [s?.student_id])

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
    <div className="space-y-6 max-w-4xl">

      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />Назад
      </button>

      {/* Profile header */}
      <Card>
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-2xl shrink-0 overflow-hidden">
            {s.avatar_url
              ? <img src={s.avatar_url} className="w-full h-full object-cover" />
              : s.full_name.charAt(0)
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{s.full_name}</h1>
              {s.target_score && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Star size={12} />Цель: {s.target_score}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              <span className="flex items-center gap-1.5"><Mail size={13} />{s.email}</span>
              {s.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{s.phone}</span>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {s.groups.map(g => (
                <span key={g.id} className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full">
                  <Users size={11} />{g.name}
                  <span className="text-primary-400">· {g.course_title}</span>
                </span>
              ))}
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
            <span className="text-green-500">{s.attendance_present}✓</span>
            <span className="text-orange-400">{s.attendance_late}⏱</span>
            <span className="text-red-400">{s.attendance_absent}✗</span>
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
                    <div className="text-xs text-blue-600 mt-1 italic">💬 {hw.feedback}</div>
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
        <EnrolledCoursesSection studentId={s.student_id} currentRole={currentUserRole} />
      )}

      {/* Subscription */}
      <Section title="Подписка">
        {subLoading ? (
          <div className="flex items-center gap-2 justify-center py-8 text-gray-400">
            <Loader2 size={16} className="animate-spin" />Загрузка…
          </div>
        ) : !subscription ? (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <AlertCircle size={28} className="text-gray-300" />
            <p className="text-sm text-gray-400">Активной подписки нет</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Plan header */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                <CreditCard size={18} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{subscription.plans?.name || 'Тариф'}</span>
                  <SubscriptionStatusBadge status={subscription.status} />
                </div>
                {subscription.plans?.description && (
                  <p className="text-xs text-gray-400 mt-0.5">{subscription.plans.description}</p>
                )}
              </div>
              {subscription.plans?.price != null && (
                <div className="text-right shrink-0">
                  <div className="font-bold text-gray-900">
                    {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: subscription.plans.currency || 'RUB', minimumFractionDigits: 0 }).format(subscription.plans.price)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {subscription.plans.billing_period === 'month' ? '/ месяц' : subscription.plans.billing_period === 'year' ? '/ год' : 'разово'}
                  </div>
                </div>
              )}
            </div>

            {/* Period */}
            {subscription.current_period_start && subscription.current_period_end && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Начало периода</div>
                  <div className="text-sm font-semibold text-gray-700">
                    {new Date(subscription.current_period_start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">
                    {subscription.cancel_at_period_end ? 'Истекает' : 'Следующее списание'}
                  </div>
                  <div className={cn(
                    'text-sm font-semibold',
                    subscription.cancel_at_period_end ? 'text-orange-600' : 'text-gray-700'
                  )}>
                    {new Date(subscription.current_period_end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>
              </div>
            )}

            {/* Auto-renewal row */}
            <div className="flex items-center gap-2 text-sm">
              <RefreshCw size={14} className={cn(subscription.cancel_at_period_end ? 'text-gray-300' : 'text-green-500')} />
              <span className={cn(subscription.cancel_at_period_end ? 'text-gray-400 line-through' : 'text-gray-600')}>
                Автопродление
              </span>
              {subscription.cancel_at_period_end && (
                <span className="text-xs text-orange-500 font-medium ml-1">— отключено</span>
              )}
            </div>

            {/* Features */}
            {subscription.plans?.features && subscription.plans.features.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-gray-100">
                {subscription.plans.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                    <CheckCircle size={12} className="text-primary-400 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Subscription status badge ────────────────────────────────────────────────
function SubscriptionStatusBadge({ status }: { status: Subscription['status'] }) {
  const MAP: Record<Subscription['status'], { label: string; cls: string }> = {
    active:    { label: 'Активна',   cls: 'bg-green-100 text-green-700' },
    trial:     { label: 'Пробная',   cls: 'bg-blue-100 text-blue-700' },
    past_due:  { label: 'Просрочена', cls: 'bg-red-100 text-red-700' },
    cancelled: { label: 'Отменена',  cls: 'bg-gray-100 text-gray-500' },
    expired:   { label: 'Истекла',   cls: 'bg-gray-100 text-gray-500' },
    pending:   { label: 'Ожидает',   cls: 'bg-yellow-100 text-yellow-700' },
  }
  const { label, cls } = MAP[status] || { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cls)}>{label}</span>
}

// ── Enrolled courses section ───────────────────────────────────────────────
function EnrolledCoursesSection({ studentId, currentRole }: { studentId: string; currentRole: string | undefined }) {
  const { courses, loading, unenroll, reload } = useStudentCourses(studentId)
  const [modalOpen, setModalOpen] = useState(false)
  const canManage = currentRole === 'admin' || currentRole === 'owner' || currentRole === 'curator'

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    active:    { label: 'Активен',  cls: 'bg-green-100 text-green-700' },
    trial:     { label: 'Триал',    cls: 'bg-blue-100 text-blue-700' },
    expired:   { label: 'Истёк',    cls: 'bg-gray-100 text-gray-500' },
    cancelled: { label: 'Отменён',  cls: 'bg-red-100 text-red-700' },
  }

  const SOURCE_LABELS: Record<string, string> = {
    purchase: 'Покупка',
    manual:   'Админ',
    trial:    'Триал',
    gift:     'Подарок',
  }

  async function handleRemove(id: string, title: string) {
    if (!confirm(`Удалить запись на курс «${title}»?`)) return
    await unenroll(id)
  }

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
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus size={13} className="mr-1" />Добавить курс
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
            <button onClick={() => setModalOpen(true)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              Записать на курс →
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {courses.map(c => {
            const meta = STATUS_BADGE[c.status]
            const expired = c.expires_at && new Date(c.expires_at) < new Date()
            return (
              <div key={c.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
                <div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  <BookOpen size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{c.course_title}</span>
                    {meta && <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', meta.cls)}>{meta.label}</span>}
                    <span className="text-xs text-gray-400">· {SOURCE_LABELS[c.source]}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {c.course_subject === 'physics' ? 'Физика' : c.course_subject === 'math' ? 'Математика' : c.course_subject}
                    {c.course_exam_type && ` · ${c.course_exam_type.toUpperCase()}`}
                    <span className="inline-flex items-center gap-1 text-gray-400">
                      <Calendar size={11} />
                      Записан {new Date(c.enrolled_at).toLocaleDateString('ru-RU')}
                    </span>
                    {c.expires_at && (
                      <span className={cn('inline-flex items-center gap-1', expired ? 'text-red-500 font-medium' : 'text-gray-400')}>
                        <Clock size={11} />
                        {expired ? 'Истёк' : 'до'} {new Date(c.expires_at).toLocaleDateString('ru-RU')}
                      </span>
                    )}
                  </div>
                  {c.notes && (
                    <div className="text-xs text-gray-400 italic mt-1">{c.notes}</div>
                  )}
                </div>
                {canManage && (
                  <button
                    onClick={() => handleRemove(c.id, c.course_title)}
                    className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1"
                    title="Удалить запись"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <EnrollCourseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={reload}
        studentId={studentId}
        excludeIds={courses.map(c => c.course_id)}
      />
    </Card>
  )
}
