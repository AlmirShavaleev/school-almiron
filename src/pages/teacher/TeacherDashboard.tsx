import { useNavigate } from 'react-router-dom'
import {
  Users, Calendar, CheckCircle2, Clock,
  ArrowRight, ClipboardList, ClipboardCheck,
  GraduationCap, Activity,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useTeacherDashboard } from '@/hooks/useTeacherDashboard'
import { useTeacherHomeworkSummary } from '@/hooks/useTeacherHomeworkSummary'
import { formatDateTime, formatDate } from '@/utils/format'

export function TeacherDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  const {
    groups, lessons, stats,
    todayLessons, loading,
  } = useTeacherDashboard(profile?.id)
  const { summary: hwSummary, loading: hwSummaryLoading } = useTeacherHomeworkSummary()

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Upcoming lessons (excluding today)
  const upcomingLessons = lessons.filter(l => {
    const d = new Date(l.scheduled_at)
    const e = new Date(); e.setHours(23, 59, 59, 999)
    return d > e
  }).slice(0, 5)

  const firstName = profile?.full_name?.split(' ')[1] || profile?.full_name?.split(' ')[0] || 'Учитель'

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="platform-surface rounded-lg p-5 sm:p-6 overflow-hidden relative">
        <div className="absolute right-0 top-0 h-full w-56 bg-gradient-to-l from-primary-50/90 to-transparent pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
              <Activity size={13} />
              Command Center
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-graphite-950">
              Привет, {firstName}
            </h1>
            <p className="text-slate-500 mt-1 text-sm">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <button onClick={() => navigate('/course-program')} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
              <div className="text-xs text-slate-500">Курсы</div>
              <div className="font-semibold text-graphite-950">Мои курсы</div>
            </button>
            <button onClick={() => navigate('/homework-review')} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
              <div className="text-xs text-slate-500">Очередь</div>
              <div className="font-semibold text-graphite-950">{hwSummary?.attempts_awaiting_review ?? 0}</div>
            </button>
            <button onClick={() => navigate('/schedule')} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
              <div className="text-xs text-slate-500">Сегодня</div>
              <div className="font-semibold text-graphite-950">{stats?.today_lessons ?? 0}</div>
            </button>
            <button onClick={() => navigate('/groups')} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
              <div className="text-xs text-slate-500">Группы</div>
              <div className="font-semibold text-graphite-950">{stats?.total_groups ?? 0}</div>
            </button>
            <button onClick={() => navigate('/homework-templates/new')} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-left hover:border-primary-200 hover:bg-primary-50/40 transition-colors">
              <div className="text-xs text-slate-500">Быстро</div>
              <div className="font-semibold text-graphite-950">Выдать ДЗ</div>
            </button>
          </div>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Групп"
          value={stats?.total_groups ?? 0}
          icon={<Users size={20} />}
          color="blue"
        />
        <StatCard
          title="Учеников"
          value={stats?.total_students ?? 0}
          icon={<GraduationCap size={20} />}
          color="purple"
        />
        <StatCard
          title="На проверке"
          value={hwSummary?.attempts_awaiting_review ?? 0}
          icon={<ClipboardList size={20} />}
          color={(hwSummary?.attempts_awaiting_review ?? 0) > 0 ? 'orange' : 'green'}
          subtitle={(hwSummary?.attempts_awaiting_review ?? 0) === 0 ? 'Всё проверено' : 'ждут оценки'}
        />
        <StatCard
          title="Сегодня занятий"
          value={stats?.today_lessons ?? 0}
          icon={<Calendar size={20} />}
          color="blue"
          subtitle={(stats?.today_lessons ?? 0) === 0 ? 'Нет занятий' : undefined}
        />
      </div>

      {/* ── Today's lessons banner ────────────────────────────────────────── */}
      {todayLessons.length > 0 && (
        <div className="space-y-2">
          {todayLessons.map(l => (
            <div key={l.id} className="flex items-center gap-3 sm:gap-4 p-4 bg-primary-50/80 border border-primary-200 rounded-lg">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                <Calendar size={20} className="text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-primary-900 text-sm sm:text-base">Сегодня занятие</div>
                <div className="text-xs sm:text-sm text-primary-700 truncate">
                  {l.title} · {formatDateTime(l.scheduled_at)} · {l.group_name}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => navigate('/attendance')}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-2 border border-primary-300 text-primary-700 text-sm font-medium rounded-xl hover:bg-primary-100 transition-colors"
                >
                  <ClipboardCheck size={14} /> Посещаемость
                </button>
                {l.zoom_link && (
                  <a
                    href={l.zoom_link}
                    target="_blank" rel="noreferrer"
                    className="min-h-11 px-3 sm:px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
                  >
                    Zoom
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 2-col grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Нужно проверить (Homework V2) */}
        <Card>
          <CardHeader>
            <CardTitle>Нужно проверить</CardTitle>
            <div className="flex items-center gap-2">
              {(hwSummary?.attempts_awaiting_review ?? 0) > 0 && <Badge variant="warning">{hwSummary!.attempts_awaiting_review}</Badge>}
              <button
                onClick={() => navigate('/homework-review')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
              >
                Все ДЗ <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>

          {hwSummaryLoading ? (
            <p className="text-gray-400 text-sm py-8 text-center">Загрузка…</p>
          ) : !hwSummary || (hwSummary.attempts_awaiting_review === 0 && hwSummary.returned_for_revision === 0) ? (
            <div className="flex flex-col items-center py-8 text-gray-400 gap-2">
              <CheckCircle2 size={28} className="opacity-30" />
              <p className="text-sm">Все работы проверены</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hwSummary.attempts_awaiting_review > 0 && (
                <div className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-orange-100 bg-orange-50 gap-3">
                  <div className="text-sm font-medium text-gray-900">Ожидают проверки</div>
                  <Button size="sm" className="shrink-0" onClick={() => navigate('/homework-review')}>
                    <ClipboardList size={13} className="mr-1" />({hwSummary.attempts_awaiting_review})
                  </Button>
                </div>
              )}
              {hwSummary.returned_for_revision > 0 && (
                <div className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-yellow-100 bg-yellow-50 gap-3">
                  <div className="text-sm font-medium text-gray-900">На доработке у учеников</div>
                  <Button size="sm" variant="secondary" className="shrink-0" onClick={() => navigate('/homework-review')}>
                    ({hwSummary.returned_for_revision})
                  </Button>
                </div>
              )}
              {hwSummary.overdue_recipients > 0 && (
                <div className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-red-100 bg-red-50 gap-3">
                  <div className="text-sm font-medium text-gray-900">Просрочено ({hwSummary.groups_with_overdue_homework} {hwSummary.groups_with_overdue_homework === 1 ? 'группа' : 'групп'})</div>
                  <span className="text-sm font-semibold text-red-600 shrink-0">{hwSummary.overdue_recipients}</span>
                </div>
              )}
              {hwSummary.recently_assigned.length > 0 && (
                <div className="pt-2 mt-2 border-t border-gray-100">
                  <div className="text-xs text-gray-400 mb-1.5">Недавно назначено</div>
                  {hwSummary.recently_assigned.slice(0, 3).map(a => (
                    <div key={a.assignment_id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-gray-700 truncate">{a.template_title} · {a.group_name}</span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">до {formatDate(a.due_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Ближайшие занятия */}
        <Card>
          <CardHeader>
            <CardTitle>Ближайшие занятия</CardTitle>
            <button
              onClick={() => navigate('/schedule')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              Расписание <ArrowRight size={12} />
            </button>
          </CardHeader>

          {upcomingLessons.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">Занятий не запланировано</p>
          ) : (
            <div className="space-y-0">
              {upcomingLessons.map(l => (
                <div key={l.id} className="flex items-center gap-3 py-3 border-b border-slate-100 last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center shrink-0">
                    <Clock size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{l.title}</div>
                    <div className="text-xs text-gray-400">{formatDateTime(l.scheduled_at)} · {l.group_name}</div>
                  </div>
                  {l.duration_minutes && (
                    <Badge variant="info" className="text-xs shrink-0">{l.duration_minutes} мин.</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Мои группы */}
        <Card>
          <CardHeader>
            <CardTitle>Мои группы</CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/course-program')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
              >
                Мои курсы <ArrowRight size={12} />
              </button>
              <button
                onClick={() => navigate('/groups')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
              >
                Группы <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>

          {groups.length === 0 ? (
            <p className="text-gray-400 text-sm py-6 text-center">Групп не найдено</p>
          ) : (
            <div className="space-y-2">
              {groups.map(g => (
                <div
                  key={g.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center shrink-0">
                      <Users size={14} className="text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{g.name}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {g.course_title || '—'}
                        {g.schedule_days && g.schedule_days.length > 0 && (
                          <span className="ml-1">· {g.schedule_days.join(', ')}{g.schedule_time && ` ${g.schedule_time}`}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="info">{g.student_count} уч.</Badge>
                    {!g.is_active && <Badge variant="default" className="text-xs">архив</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}
