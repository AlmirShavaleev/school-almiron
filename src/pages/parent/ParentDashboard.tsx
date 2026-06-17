import { useNavigate } from 'react-router-dom'
import {
  Users, CreditCard, BookOpen, TrendingUp, CheckSquare, Calendar,
  Clock, CheckCircle, X as XIcon, AlertCircle, Star, Target,
  ArrowRight, RefreshCw, Zap, ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useParentDashboard, type ParentChild } from '@/hooks/useParentDashboard'
import { formatDate, formatDateTime, LEAGUE_LABELS, LEAGUE_COLORS, HW_STATUS_COLORS, HW_STATUS_LABELS } from '@/utils/format'
import { cn } from '@/utils/cn'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isToday(iso: string) {
  const d = new Date(iso), n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}
function isOverdue(iso: string) { return new Date(iso) < new Date() }

// ─── Attendance dot ───────────────────────────────────────────────────────────
function AttDot({ status }: { status: string }) {
  if (status === 'present') return <CheckCircle size={13} className="text-green-500 shrink-0" />
  if (status === 'absent')  return <XIcon size={13} className="text-red-500 shrink-0" />
  if (status === 'late')    return <Clock size={13} className="text-orange-400 shrink-0" />
  return null
}

// ─── Sub status badge ─────────────────────────────────────────────────────────
function SubBadge({ status }: { status: string }) {
  const MAP: Record<string, string> = {
    active:   'bg-green-100 text-green-700',
    trial:    'bg-blue-100 text-blue-700',
    past_due: 'bg-red-100 text-red-700',
    cancelled:'bg-gray-100 text-gray-500',
    pending:  'bg-yellow-100 text-yellow-700',
    expired:  'bg-gray-100 text-gray-500',
  }
  const LABELS: Record<string, string> = {
    active: 'Активна', trial: 'Пробная', past_due: 'Просрочена',
    cancelled: 'Отменена', pending: 'Ожидает', expired: 'Истекла',
  }
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', MAP[status] || 'bg-gray-100 text-gray-500')}>
      {LABELS[status] || status}
    </span>
  )
}

// ─── Child selector ───────────────────────────────────────────────────────────
function ChildSelector({
  children, selectedId, onSelect,
}: {
  children: ParentChild[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = children.find(c => c.student_id === selectedId) || children[0]
  if (!selected) return null
  if (children.length === 1) return null  // hide if only one child

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-primary-300 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold">
          {selected.full_name.charAt(0)}
        </div>
        {selected.full_name.split(' ')[1] || selected.full_name}
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
          {children.map(c => (
            <button
              key={c.student_id}
              onClick={() => { onSelect(c.student_id); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors',
                c.student_id === selectedId ? 'text-primary-600 font-medium' : 'text-gray-700'
              )}
            >
              <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold shrink-0">
                {c.full_name.charAt(0)}
              </div>
              <div className="text-left">
                <div className="leading-tight">{c.full_name}</div>
                {c.grade && <div className="text-xs text-gray-400">{c.grade} класс</div>}
              </div>
              {c.student_id === selectedId && <CheckCircle size={14} className="ml-auto text-primary-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function ParentDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const { children, selectedChild: child, selectedChildId, setSelectedChildId, loading } =
    useParentDashboard(profile?.id)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!child) return (
    <div className="text-center py-20 text-gray-400">
      <Users size={48} className="mx-auto mb-4 opacity-30" />
      <p className="text-lg font-medium text-gray-500 mb-1">Дети не привязаны</p>
      <p className="text-sm">Обратитесь к куратору или администратору</p>
    </div>
  )

  const lessonIsToday  = child.upcoming_lesson && isToday(child.upcoming_lesson.scheduled_at)
  const urgentHW       = child.homeworks.filter(h =>
    (h.status === 'not_submitted' || h.status === 'pending') &&
    (isOverdue(h.due_date) || new Date(h.due_date).getTime() - Date.now() < 3 * 86400_000)
  ).slice(0, 3)

  const progressData = child.mock_results.slice().reverse().map(m => ({
    label: new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    pct:   Math.round(m.score / m.max_score * 100),
  })).slice(-6)

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Кабинет родителя
          </h1>
          <p className="text-gray-500 mt-0.5">Добро пожаловать, {profile?.full_name?.split(' ')[1] || profile?.full_name}!</p>
        </div>
        <ChildSelector children={children} selectedId={selectedChildId} onSelect={setSelectedChildId} />
      </div>

      {/* ── Child hero card ───────────────────────────────────────── */}
      <Card className="bg-gradient-to-r from-primary-50 to-blue-50 border-primary-200">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary-100 border-2 border-primary-200 flex items-center justify-center text-primary-700 font-bold text-2xl shrink-0 overflow-hidden">
            {child.avatar_url
              ? <img src={child.avatar_url} className="w-full h-full object-cover" alt="" />
              : child.full_name.charAt(0)
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900">{child.full_name}</h2>
              <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', LEAGUE_COLORS[child.league] || 'bg-gray-100 text-gray-600')}>
                🏅 {LEAGUE_LABELS[child.league] || child.league}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
              {child.grade && <span>{child.grade} класс</span>}
              {child.target_exam && <span>{child.target_exam.toUpperCase()}</span>}
              {child.target_subject && <span>{child.target_subject === 'physics' ? 'Физика' : 'Математика'}</span>}
              {child.target_score && (
                <span className="flex items-center gap-1"><Target size={13} />Цель: {child.target_score} б.</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1.5 text-primary-600 font-bold text-xl">
              <Zap size={16} className="text-purple-500" />{child.xp_points.toLocaleString()}
            </div>
            <div className="text-xs text-gray-400">XP очков</div>
          </div>
        </div>
      </Card>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Посещаемость"
          value={child.attendance_rate > 0 ? `${child.attendance_rate}%` : '—'}
          icon={<CheckSquare size={20} />}
          color={child.attendance_rate >= 80 ? 'green' : child.attendance_rate >= 60 ? 'orange' : 'red'}
          subtitle={`${child.attendance_present}✓ ${child.attendance_late}⏱ ${child.attendance_absent}✗`}
        />
        <StatCard
          title="Домашние задания"
          value={child.hw_total > 0 ? `${child.hw_checked}/${child.hw_total}` : '—'}
          icon={<BookOpen size={20} />}
          color={child.hw_pending > 0 ? 'orange' : 'green'}
          subtitle={child.hw_pending > 0 ? `${child.hw_pending} не сдано` : 'Всё сдано 🎉'}
        />
        <StatCard
          title="Пробники"
          value={child.mock_count}
          icon={<TrendingUp size={20} />}
          color="purple"
          subtitle={child.mock_avg != null ? `Среднее: ${child.mock_avg}%` : 'Пока нет'}
        />
        <StatCard
          title="Цель"
          value={child.target_score ? `${child.target_score} б.` : '—'}
          icon={<Star size={20} />}
          color="blue"
          subtitle={child.target_exam?.toUpperCase() || 'Не задана'}
        />
      </div>

      {/* ── Today lesson banner ───────────────────────────────────── */}
      {lessonIsToday && child.upcoming_lesson && (
        <div className="flex items-center gap-4 p-4 bg-primary-50 border border-primary-200 rounded-2xl">
          <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center shrink-0">
            <Calendar size={20} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-primary-900">Сегодня занятие у {child.full_name.split(' ')[1] || child.full_name}!</div>
            <div className="text-sm text-primary-700">{child.upcoming_lesson.title} · {formatDateTime(child.upcoming_lesson.scheduled_at)}</div>
          </div>
          {child.upcoming_lesson.zoom_link && (
            <a href={child.upcoming_lesson.zoom_link} target="_blank" rel="noreferrer"
              className="shrink-0 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors">
              Ссылка →
            </a>
          )}
        </div>
      )}

      {/* ── Urgent HW banner ─────────────────────────────────────── */}
      {urgentHW.length > 0 && (
        <div className="flex items-start gap-4 p-4 bg-orange-50 border border-orange-200 rounded-2xl">
          <AlertCircle size={20} className="text-orange-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-orange-800 mb-1.5">Срочно сдать!</div>
            <div className="space-y-1">
              {urgentHW.map(hw => (
                <div key={hw.id} className="flex items-center justify-between text-sm">
                  <span className="text-orange-900">{hw.title}</span>
                  <span className="text-xs text-orange-600 shrink-0 ml-3">до {formatDate(hw.due_date)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Subscription widget ───────────────────────────────────── */}
      {child.subscription && (
        <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-primary-50 to-purple-50 border border-primary-200 rounded-2xl">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <CreditCard size={18} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-primary-900">{child.subscription.plan_name}</span>
              <SubBadge status={child.subscription.status} />
              {child.subscription.cancel_at_period_end && (
                <span className="text-xs text-orange-500 font-medium">— отменяется</span>
              )}
            </div>
            {child.subscription.period_end && (
              <div className="text-xs text-primary-600 mt-0.5 flex items-center gap-1">
                <RefreshCw size={11} />
                {child.subscription.cancel_at_period_end ? 'Истекает' : 'Следующий платёж'}
                {' '}{new Date(child.subscription.period_end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold text-gray-900">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: child.subscription.currency, minimumFractionDigits: 0 }).format(child.subscription.price)}
            </div>
            <div className="text-xs text-gray-400">
              {child.subscription.billing_period === 'month' ? '/ месяц' : child.subscription.billing_period === 'year' ? '/ год' : 'разово'}
            </div>
          </div>
        </div>
      )}

      {!child.subscription && (
        <div className="flex items-center gap-4 p-4 bg-gray-50 border border-dashed border-gray-300 rounded-2xl">
          <CreditCard size={18} className="text-gray-300 shrink-0" />
          <div>
            <div className="text-sm font-medium text-gray-500">Нет активной подписки</div>
            <div className="text-xs text-gray-400">У ребёнка не оформлен тариф</div>
          </div>
          <button
            onClick={() => navigate('/pricing')}
            className="ml-auto flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0"
          >
            Выбрать тариф <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* ── Main 2-col grid ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Ближайшее занятие */}
        <Card>
          <CardHeader>
            <CardTitle>Ближайшее занятие</CardTitle>
            <Calendar size={16} className="text-gray-400" />
          </CardHeader>
          {child.upcoming_lesson ? (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <div className="font-semibold text-gray-900">{child.upcoming_lesson.title}</div>
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Clock size={13} />
                {formatDateTime(child.upcoming_lesson.scheduled_at)}
                <span className="text-gray-300">·</span>
                {child.upcoming_lesson.duration_minutes} мин.
              </div>
              {child.upcoming_lesson.zoom_link && !lessonIsToday && (
                <a href={child.upcoming_lesson.zoom_link} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary-600 font-medium">
                  🎥 Ссылка на занятие
                </a>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm py-4 text-center">Занятий не запланировано</p>
          )}
        </Card>

        {/* Посещаемость */}
        <Card>
          <CardHeader>
            <CardTitle>Последние занятия</CardTitle>
            <CheckSquare size={16} className="text-gray-400" />
          </CardHeader>
          {child.recent_attendance.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Нет данных</p>
          ) : (
            <div className="space-y-1">
              {child.recent_attendance.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg hover:bg-gray-50 transition-colors">
                  <AttDot status={a.status} />
                  <span className="flex-1 text-sm text-gray-700 truncate">{a.lesson_title}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(a.scheduled_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Домашние задания */}
        <Card>
          <CardHeader>
            <CardTitle>Домашние задания</CardTitle>
            <span className={cn(
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              child.hw_pending > 0 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
            )}>
              {child.hw_pending} не сдано
            </span>
          </CardHeader>
          {child.homeworks.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">Заданий нет</p>
          ) : (
            <div className="space-y-1.5">
              {child.homeworks.slice(0, 6).map(hw => {
                const over = isOverdue(hw.due_date) && (hw.status === 'not_submitted' || hw.status === 'pending')
                return (
                  <div key={hw.id} className={cn(
                    'flex items-center gap-2 py-2 px-2.5 rounded-xl border',
                    over ? 'border-red-200 bg-red-50' : 'border-gray-100'
                  )}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{hw.title}</div>
                      <div className={cn('text-xs mt-0.5', over ? 'text-red-500 font-medium' : 'text-gray-400')}>
                        {over ? '🔴 Просрочено · ' : 'до '}{formatDate(hw.due_date)}
                      </div>
                    </div>
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', HW_STATUS_COLORS[hw.status] || 'bg-gray-100 text-gray-500')}>
                      {HW_STATUS_LABELS[hw.status] || hw.status}
                      {hw.score != null && ` · ${hw.score}/${hw.max_score}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Прогресс пробников */}
        <Card>
          <CardHeader>
            <CardTitle>Прогресс пробников</CardTitle>
            {child.mock_avg != null && (
              <span className="text-sm text-gray-400">
                Среднее: <span className="font-semibold text-gray-700">{child.mock_avg}%</span>
              </span>
            )}
          </CardHeader>
          {progressData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={progressData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="parentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip formatter={(v) => [`${v}%`, 'Результат']} />
                <Area type="monotone" dataKey="pct" stroke="#6366f1" fill="url(#parentGrad)" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : child.mock_results.length === 1 ? (
            <div className="flex items-center gap-4 py-3">
              <div className="w-14 h-14 relative shrink-0">
                <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#e5e7eb" strokeWidth="3" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#6366f1" strokeWidth="3"
                    strokeDasharray={`${Math.round(child.mock_results[0].score / child.mock_results[0].max_score * 100)}, 100`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-700">
                  {Math.round(child.mock_results[0].score / child.mock_results[0].max_score * 100)}%
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary-600">{child.mock_results[0].score} б.</div>
                <div className="text-xs text-gray-400">{child.mock_results[0].title}</div>
                <div className="text-xs text-gray-400">{formatDate(child.mock_results[0].date)}</div>
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm py-8 text-center">Пробников пока нет</p>
          )}
        </Card>
      </div>
    </div>
  )
}
