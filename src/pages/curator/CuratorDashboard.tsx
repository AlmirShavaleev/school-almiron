import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Users, CheckSquare, Bell, ClipboardList,
  Clock, CheckCircle, BookOpen, ArrowRight, Calendar, FileCheck,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useCuratorDashboard, type RiskStudent, type OverdueHW, type PendingSubmission } from '@/hooks/useCuratorDashboard'
import { formatDate } from '@/utils/format'
import { cn } from '@/utils/cn'

// ─── Risk badge ───────────────────────────────────────────────────────────────
const RISK_LABELS: Record<string, { label: string; cls: string }> = {
  low_attendance: { label: 'Пропуски',  cls: 'bg-red-100 text-red-700' },
  overdue_hw:     { label: 'Долги ДЗ', cls: 'bg-orange-100 text-orange-700' },
  low_xp:         { label: 'Мало XP',  cls: 'bg-yellow-100 text-yellow-700' },
  inactive:       { label: 'Неактивен', cls: 'bg-gray-100 text-gray-600' },
}

function RiskBadge({ reason }: { reason: string }) {
  const { label, cls } = RISK_LABELS[reason] || { label: reason, cls: 'bg-gray-100 text-gray-500' }
  return <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', cls)}>{label}</span>
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 3000)
  }, [])
  return { msg, show }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function CuratorDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()
  const { toast: toastMsg, show: showToast } = { toast: null as string | null, show: (_: string) => {} }
  const { msg: toast, show } = useToast()

  const {
    groups, atRisk, recentAbsences, overdueHW, pendingSubmissions,
    totalStudents, avgAttRate,
    loading, sendReminder, notifyGroup,
  } = useCuratorDashboard(profile?.id)

  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set())
  const [notifiedHW,   setNotifiedHW]   = useState<Set<string>>(new Set())

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (groups.length === 0) return (
    <div className="text-center py-20 text-gray-400">
      <Users size={48} className="mx-auto mb-4 opacity-30" />
      <p className="text-lg font-medium text-gray-500 mb-1">Группы не назначены</p>
      <p className="text-sm">Обратитесь к администратору</p>
    </div>
  )

  async function handleReminder(student: RiskStudent) {
    await sendReminder(student.profile_id, student.full_name)
    setReminderSent(prev => new Set(prev).add(student.id))
    show(`✓ Уведомление отправлено ${student.full_name.split(' ')[1] || student.full_name}`)
  }

  async function handleNotifyGroup(hw: OverdueHW) {
    await notifyGroup(hw.group_id)
    setNotifiedHW(prev => new Set(prev).add(hw.id))
    show(`✓ Уведомление отправлено группе ${hw.group_name}`)
  }

  return (
    <div className="space-y-6">

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Кабинет куратора</h1>
          <p className="text-gray-500 mt-0.5">
            {profile?.full_name} · {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <button
          onClick={() => navigate('/attendance')}
          className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          <CheckSquare size={15} />Посещаемость
        </button>
      </div>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Групп"
          value={groups.length}
          icon={<Users size={20} />}
          color="blue"
          subtitle={`${totalStudents} учеников`}
        />
        <StatCard
          title="Посещаемость"
          value={avgAttRate > 0 ? `${avgAttRate}%` : '—'}
          icon={<CheckSquare size={20} />}
          color={avgAttRate >= 80 ? 'green' : avgAttRate >= 60 ? 'orange' : 'red'}
          subtitle="Среднее по группам"
        />
        <StatCard
          title="В зоне риска"
          value={atRisk.length}
          icon={<AlertTriangle size={20} />}
          color={atRisk.length > 0 ? 'red' : 'green'}
          subtitle={atRisk.length === 0 ? 'Все активны 🎉' : 'Нужна помощь'}
        />
        <StatCard
          title="Просроч. ДЗ"
          value={overdueHW.length}
          icon={<ClipboardList size={20} />}
          color={overdueHW.length > 0 ? 'orange' : 'green'}
          subtitle={overdueHW.length === 0 ? 'Всё сдано 🎉' : 'По всем группам'}
        />
      </div>

      {/* ── Groups grid ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <BookOpen size={16} className="text-primary-500" />Мои группы
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <div key={g.id}
              className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{g.name}</div>
                  <div className="text-xs text-primary-600 mt-0.5">{g.course_title}</div>
                </div>
                <span className="text-xs font-medium bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full ml-2 shrink-0">
                  {g.student_count} уч.
                </span>
              </div>

              {/* Mini stats */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className={cn(
                  'rounded-xl px-3 py-2 text-center',
                  g.att_rate >= 80 ? 'bg-green-50' : g.att_rate >= 60 ? 'bg-orange-50' : 'bg-red-50'
                )}>
                  <div className={cn('text-lg font-bold',
                    g.att_rate >= 80 ? 'text-green-700' : g.att_rate >= 60 ? 'text-orange-600' : 'text-red-600'
                  )}>
                    {g.att_rate > 0 ? `${g.att_rate}%` : '—'}
                  </div>
                  <div className="text-[10px] text-gray-500 font-medium">Посещаемость</div>
                </div>
                <div className={cn('rounded-xl px-3 py-2 text-center', g.hw_overdue > 0 ? 'bg-orange-50' : 'bg-green-50')}>
                  <div className={cn('text-lg font-bold', g.hw_overdue > 0 ? 'text-orange-600' : 'text-green-700')}>
                    {g.hw_overdue}
                  </div>
                  <div className="text-[10px] text-gray-500 font-medium">Просроч. ДЗ</div>
                </div>
              </div>

              {g.schedule_days && g.schedule_days.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Calendar size={11} />
                  {g.schedule_days.join(', ')}
                  {g.schedule_time && ` · ${g.schedule_time}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main 2-col grid ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* At-risk students */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              <CardTitle>Зона риска</CardTitle>
              {atRisk.length > 0 && (
                <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {atRisk.length}
                </span>
              )}
            </div>
          </CardHeader>
          {atRisk.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <CheckCircle size={28} className="text-green-400" />
              <p className="text-sm text-gray-400">Все ученики активны 🎉</p>
            </div>
          ) : (
            <div className="space-y-2">
              {atRisk.slice(0, 8).map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-700 text-sm font-bold shrink-0">
                    {s.full_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{s.full_name}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {s.risk_reasons.map(r => <RiskBadge key={r} reason={r} />)}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {s.group_name} · {s.att_rate}% явка · {s.hw_pending} долгов
                      {s.last_seen_days != null && s.last_seen_days > 7 && ` · не было ${s.last_seen_days} дн.`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleReminder(s)}
                    disabled={reminderSent.has(s.id)}
                    className={cn(
                      'shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      reminderSent.has(s.id)
                        ? 'bg-green-100 text-green-700 cursor-default'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    )}
                  >
                    {reminderSent.has(s.id)
                      ? <><CheckCircle size={12} /> Отправлено</>
                      : <><Bell size={12} /> Напомнить</>
                    }
                  </button>
                </div>
              ))}
              {atRisk.length > 8 && (
                <p className="text-xs text-center text-gray-400 py-1">+{atRisk.length - 8} ещё</p>
              )}
            </div>
          )}
        </Card>

        {/* Recent absences */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-orange-500" />
              <CardTitle>Последние пропуски</CardTitle>
            </div>
          </CardHeader>
          {recentAbsences.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <CheckCircle size={28} className="text-green-400" />
              <p className="text-sm text-gray-400">Пропусков нет</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentAbsences.map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 text-xs font-bold shrink-0">
                    {a.student_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{a.student_name}</div>
                    <div className="text-xs text-gray-400 truncate">{a.lesson_title}</div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(a.scheduled_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>

      {/* ── Pending submissions ──────────────────────────────────── */}
      {pendingSubmissions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileCheck size={16} className="text-primary-500" />
              <CardTitle>Ждут проверки</CardTitle>
              <span className="text-xs font-bold bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">
                {pendingSubmissions.length}
              </span>
            </div>
            <button
              onClick={() => navigate('/homeworks')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              Все ДЗ <ArrowRight size={12} />
            </button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left pb-3 font-medium">Ученик</th>
                  <th className="text-left pb-3 font-medium">Задание</th>
                  <th className="text-left pb-3 font-medium">Группа</th>
                  <th className="text-right pb-3 font-medium">Сдано</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pendingSubmissions.slice(0, 10).map(s => (
                  <tr
                    key={s.submission_id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/homeworks/${s.homework_id}`)}
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold shrink-0">
                          {s.student_name.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900 truncate">{s.student_name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-gray-700 max-w-[180px] truncate">{s.homework_title}</td>
                    <td className="py-2.5 text-gray-400 text-xs">{s.group_name}</td>
                    <td className="py-2.5 text-right text-xs text-gray-400">
                      {new Date(s.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendingSubmissions.length > 10 && (
              <p className="text-xs text-center text-gray-400 pt-3 pb-1">
                +{pendingSubmissions.length - 10} ещё — <button className="text-primary-600 hover:underline" onClick={() => navigate('/homeworks')}>открыть все</button>
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ── Overdue HW ───────────────────────────────────────────── */}
      {overdueHW.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList size={16} className="text-orange-500" />
              <CardTitle>Просроченные домашние задания</CardTitle>
              <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                {overdueHW.length}
              </span>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left pb-3 font-medium">Задание</th>
                  <th className="text-left pb-3 font-medium">Срок</th>
                  <th className="text-left pb-3 font-medium">Группа</th>
                  <th className="text-center pb-3 font-medium">Не сдали</th>
                  <th className="text-right pb-3 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {overdueHW.map(hw => {
                  const daysAgo = Math.floor((Date.now() - new Date(hw.due_date).getTime()) / 86400000)
                  return (
                    <tr key={hw.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 font-medium text-gray-900">{hw.title}</td>
                      <td className="py-3">
                        <span className="text-red-600 text-xs font-medium">
                          {formatDate(hw.due_date)}
                          <span className="text-gray-400 font-normal ml-1">({daysAgo} дн. назад)</span>
                        </span>
                      </td>
                      <td className="py-3 text-gray-500 text-xs">{hw.group_name}</td>
                      <td className="py-3 text-center">
                        {hw.pending_count > 0 ? (
                          <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {hw.pending_count}
                          </span>
                        ) : (
                          <span className="text-green-500 text-xs">✓ все</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleNotifyGroup(hw)}
                          disabled={notifiedHW.has(hw.id)}
                          className={cn(
                            'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ml-auto transition-all',
                            notifiedHW.has(hw.id)
                              ? 'bg-green-100 text-green-700 cursor-default'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          )}
                        >
                          {notifiedHW.has(hw.id)
                            ? <><CheckCircle size={11} /> Отправлено</>
                            : <><Bell size={11} /> Напомнить группе</>
                          }
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Quick links ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Посещаемость', icon: <CheckSquare size={16} />, path: '/attendance', color: 'text-green-600 bg-green-50 border-green-200' },
          { label: 'Расписание',   icon: <Calendar size={16} />,    path: '/schedule',   color: 'text-blue-600 bg-blue-50 border-blue-200' },
          { label: 'Группы',       icon: <Users size={16} />,       path: '/groups',     color: 'text-purple-600 bg-purple-50 border-purple-200' },
          { label: 'Домашние задания', icon: <BookOpen size={16} />, path: '/homeworks', color: 'text-orange-600 bg-orange-50 border-orange-200' },
        ].map(l => (
          <button
            key={l.path}
            onClick={() => navigate(l.path)}
            className={cn('flex items-center gap-2 p-3 rounded-xl border text-sm font-medium hover:shadow-sm transition-all', l.color)}
          >
            {l.icon}{l.label}<ArrowRight size={13} className="ml-auto opacity-50" />
          </button>
        ))}
      </div>

    </div>
  )
}
