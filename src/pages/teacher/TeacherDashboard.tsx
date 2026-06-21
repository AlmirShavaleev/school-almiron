import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Calendar, CheckCircle2,
  ArrowRight, ClipboardList, ClipboardCheck,
  GraduationCap,
} from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useTeacherDashboard } from '@/hooks/useTeacherDashboard'
import { ReviewHomeworkModal } from '@/components/modals/ReviewHomeworkModal'
import { formatDateTime } from '@/utils/format'

function isOverdue(iso: string) { return new Date(iso) < new Date() }

export function TeacherDashboard() {
  const profile  = useAuthStore(s => s.profile)
  const navigate = useNavigate()

  const {
    groups, lessons, homeworks, pendingSubs, stats,
    todayLessons, loading, reload,
  } = useTeacherDashboard(profile?.id)

  const [reviewTarget, setReviewTarget] = useState<{ id: string; title: string; max_score: number } | null>(null)

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // HW with pending reviews (sorted: most pending first)
  const hwWithPending = homeworks
    .filter(hw => hw.pending_count > 0)
    .sort((a, b) => b.pending_count - a.pending_count)

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Привет, {firstName}! 👋
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
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
          value={stats?.pending_reviews ?? 0}
          icon={<ClipboardList size={20} />}
          color={(stats?.pending_reviews ?? 0) > 0 ? 'orange' : 'green'}
          subtitle={(stats?.pending_reviews ?? 0) === 0 ? 'Всё проверено 🎉' : 'ждут оценки'}
        />
        <StatCard
          title="Сегодня занятий"
          value={stats?.today_lessons ?? 0}
          icon={<Calendar size={20} />}
          color="blue"
          subtitle={(stats?.today_lessons ?? 0) === 0 ? 'Выходной 🎉' : undefined}
        />
      </div>

      {/* ── Today's lessons banner ────────────────────────────────────────── */}
      {todayLessons.length > 0 && (
        <div className="space-y-2">
          {todayLessons.map(l => (
            <div key={l.id} className="flex items-center gap-3 sm:gap-4 p-4 bg-primary-50 border border-primary-200 rounded-2xl">
              <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center shrink-0">
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
                    className="px-3 sm:px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
                  >
                    Zoom →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 2-col grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Нужно проверить */}
        <Card>
          <CardHeader>
            <CardTitle>Нужно проверить</CardTitle>
            <div className="flex items-center gap-2">
              {pendingSubs.length > 0 && <Badge variant="warning">{pendingSubs.length}</Badge>}
              <button
                onClick={() => navigate('/homeworks')}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
              >
                Все ДЗ <ArrowRight size={12} />
              </button>
            </div>
          </CardHeader>

          {hwWithPending.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-400 gap-2">
              <CheckCircle2 size={28} className="opacity-30" />
              <p className="text-sm">Все работы проверены 🎉</p>
            </div>
          ) : (
            <div className="space-y-2">
              {hwWithPending.slice(0, 5).map(hw => (
                <div
                  key={hw.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-orange-100 bg-orange-50 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{hw.title}</div>
                    <div className="text-xs text-gray-500">
                      {hw.group_name}
                      {isOverdue(hw.due_date) && (
                        <span className="ml-1.5 text-red-500 font-medium">· просрочено</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => setReviewTarget({ id: hw.id, title: hw.title, max_score: hw.max_score })}
                  >
                    <ClipboardList size={13} className="mr-1" />
                    ({hw.pending_count})
                  </Button>
                </div>
              ))}
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
                <div key={l.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
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
            <button
              onClick={() => navigate('/groups')}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5"
            >
              Управление <ArrowRight size={12} />
            </button>
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

      {/* ReviewHomeworkModal */}
      <ReviewHomeworkModal
        open={reviewTarget != null}
        onClose={() => setReviewTarget(null)}
        onReviewed={() => { setReviewTarget(null); reload() }}
        homework={reviewTarget}
      />
    </div>
  )
}
