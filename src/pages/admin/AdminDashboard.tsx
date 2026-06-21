import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, BookOpen, CreditCard, BarChart3, Search, ArrowRight,
  TrendingUp, CheckCircle, RefreshCw, AlertCircle, Calendar,
  GraduationCap, Star, Plus, Pencil, Lock,
  Loader2, ShieldAlert, ClipboardList,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { StaffTab } from '@/components/admin/StaffTab'
import { CreateUserModal } from '@/components/modals/CreateUserModal'
import { QuickLogin } from '@/components/demo/QuickLogin'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { useAdminDashboard, type AdminProfile, type AdminCourse } from '@/hooks/useAdminDashboard'
import { EditCourseModal } from '@/components/modals/EditCourseModal'
import { getCourseAvailability } from '@/types'
import { cn } from '@/utils/cn'
import { ROLE_LABELS } from '@/utils/format'

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  student:  'bg-blue-100 text-blue-700',
  teacher:  'bg-green-100 text-green-700',
  curator:  'bg-yellow-100 text-yellow-700',
  admin:    'bg-red-100 text-red-700',
  owner:    'bg-purple-100 text-purple-700',
}
function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', ROLE_COLORS[role] || 'bg-gray-100 text-gray-600')}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

// ─── Sub status badge ─────────────────────────────────────────────────────────
const SUB_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  trial:    'bg-blue-100 text-blue-700',
  past_due: 'bg-red-100 text-red-700',
  cancelled:'bg-gray-100 text-gray-500',
  pending:  'bg-yellow-100 text-yellow-700',
  expired:  'bg-gray-100 text-gray-500',
}
const SUB_LABELS: Record<string, string> = {
  active: 'Активна', trial: 'Пробная', past_due: 'Просрочена',
  cancelled: 'Отменена', pending: 'Ожидает', expired: 'Истекла',
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'users' | 'groups' | 'staff' | 'courses' | 'subscriptions'
const TABS: { key: Tab; label: string; icon?: React.ReactNode }[] = [
  { key: 'overview',      label: 'Обзор' },
  { key: 'users',         label: 'Пользователи' },
  { key: 'groups',        label: 'Группы' },
  { key: 'staff',         label: 'Команда' },
  { key: 'courses',       label: 'Курсы' },
  { key: 'subscriptions', label: 'Подписки' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────
export function AdminDashboard() {
  const navigate = useNavigate()
  const currentProfile = useAuthStore(s => s.profile)
  const [tab,    setTab]    = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [courseModalOpen, setCourseModalOpen] = useState(false)
  const [editingCourse,   setEditingCourse]   = useState<AdminCourse | null>(null)
  const [savingRole,      setSavingRole]      = useState<string | null>(null)
  const [roleError,       setRoleError]       = useState<string | null>(null)
  const [createUserOpen,  setCreateUserOpen]  = useState(false)

  const { profiles, groups, courses, subscriptions, stats, loading, reload } = useAdminDashboard()

  async function changeRole(profileId: string, newRole: string) {
    setSavingRole(profileId)
    setRoleError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole } as any)
      .eq('id', profileId)
    setSavingRole(null)
    if (error) {
      setRoleError(error.message)
    } else {
      reload()   // refresh list so student_id/teacher_id links update too
    }
  }

  // Filtered users
  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const matchesSearch = !search ||
        p.full_name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase())
      const matchesRole = roleFilter === 'all' || p.role === roleFilter
      return matchesSearch && matchesRole
    })
  }, [profiles, search, roleFilter])

  // Filtered subscriptions
  const filteredSubs = useMemo(() => {
    if (!search || tab !== 'subscriptions') return subscriptions
    return subscriptions.filter(s =>
      s.student_name.toLowerCase().includes(search.toLowerCase()) ||
      s.plan_name.toLowerCase().includes(search.toLowerCase())
    )
  }, [subscriptions, search, tab])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const fmtRub = (n: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(n)

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Панель администратора</h1>
          <p className="text-gray-500 mt-0.5">Управление школой · {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={reload} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <RefreshCw size={14} />Обновить
        </button>
      </div>

      {/* ── Быстрый вход (демо impersonation) ─────────────────────── */}
      <QuickLogin />

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Пользователей"
          value={stats?.total_users ?? 0}
          icon={<Users size={20} />}
          color="blue"
          subtitle={`+${stats?.new_users_week ?? 0} за неделю`}
        />
        <StatCard
          title="Активных групп"
          value={stats?.active_groups ?? 0}
          icon={<BookOpen size={20} />}
          color="green"
          subtitle={`${stats?.total_students ?? 0} учеников`}
        />
        <StatCard
          title="Подписок"
          value={stats?.active_subs ?? 0}
          icon={<Star size={20} />}
          color="purple"
          subtitle={stats?.pending_subs ? `${stats.pending_subs} просроч.` : 'Все активны'}
        />
        <StatCard
          title="ДЗ на проверке"
          value={stats?.pending_hw_count ?? 0}
          icon={<ClipboardList size={20} />}
          color={stats && stats.pending_hw_count > 0 ? 'orange' : 'green'}
          subtitle={stats?.pending_hw_count ? 'Ждут учителей' : 'Все проверены'}
          onClick={() => navigate('/homeworks')}
        />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSearch('') }}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}>
            {t.label}
            {t.key === 'users'  && <span className="ml-1.5 text-xs text-gray-400">({profiles.length})</span>}
            {t.key === 'groups' && <span className="ml-1.5 text-xs text-gray-400">({groups.length})</span>}
            {t.key === 'subscriptions' && stats?.pending_subs ? (
              <span className="ml-1.5 text-xs font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{stats.pending_subs}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ══ ОБЗОР ════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="space-y-6">

          {/* Role breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {(['student','teacher','curator','admin','owner'] as const).map(role => {
              const count = profiles.filter(p => p.role === role).length
              return (
                <button
                  key={role}
                  onClick={() => { setTab('users'); setRoleFilter(role) }}
                  className="bg-white rounded-2xl border border-gray-200 p-4 text-center hover:border-primary-300 hover:shadow-sm transition-all group"
                >
                  <div className="text-2xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{count}</div>
                  <RoleBadge role={role} />
                </button>
              )
            })}
          </div>

          {/* Recent users + groups overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Recent registrations */}
            <Card>
              <CardHeader>
                <CardTitle>Новые пользователи</CardTitle>
                <button onClick={() => setTab('users')} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
                  Все <ArrowRight size={12} />
                </button>
              </CardHeader>
              <div className="space-y-1.5">
                {profiles.slice(0, 7).map(p => (
                  <div
                    key={p.id}
                    onClick={() => p.student_id && navigate(`/students/${p.student_id}`)}
                    className={cn(
                      'flex items-center gap-3 py-2 px-2 rounded-xl transition-colors',
                      p.student_id ? 'hover:bg-gray-50 cursor-pointer' : ''
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold shrink-0 overflow-hidden">
                      {p.avatar_url
                        ? <img src={p.avatar_url} className="w-full h-full object-cover" alt="" />
                        : p.full_name.charAt(0)
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{p.full_name}</div>
                      <div className="text-xs text-gray-400 truncate">{p.email}</div>
                    </div>
                    <RoleBadge role={p.role} />
                  </div>
                ))}
              </div>
            </Card>

            {/* Groups health */}
            <Card>
              <CardHeader>
                <CardTitle>Группы</CardTitle>
                <button onClick={() => navigate('/groups')} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
                  Управление <ArrowRight size={12} />
                </button>
              </CardHeader>
              <div className="space-y-2.5">
                {groups.slice(0, 6).map(g => {
                  const fill = g.max_students > 0 ? Math.min(Math.round(g.student_count / g.max_students * 100), 100) : 0
                  return (
                    <div key={g.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-800 truncate">{g.name}</span>
                          <span className="text-xs text-gray-400 shrink-0 ml-2">{g.student_count}/{g.max_students}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className={cn('h-1.5 rounded-full', fill >= 90 ? 'bg-red-400' : fill >= 70 ? 'bg-orange-400' : 'bg-primary-500')}
                            style={{ width: `${fill}%` }}
                          />
                        </div>
                      </div>
                      <span className={cn(
                        'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                        g.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {g.is_active ? 'Активна' : 'Закрыта'}
                      </span>
                    </div>
                  )
                })}
                {groups.length > 6 && (
                  <p className="text-xs text-gray-400 text-center pt-1">+{groups.length - 6} групп</p>
                )}
              </div>
            </Card>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Посещаемость',       icon: <CheckCircle size={16} />,    path: '/attendance',  color: 'text-green-600 bg-green-50 border-green-200' },
              { label: 'Пробники',           icon: <BarChart3 size={16} />,      path: '/mock-exams',  color: 'text-purple-600 bg-purple-50 border-purple-200' },
              { label: 'Расписание',         icon: <Calendar size={16} />,       path: '/schedule',    color: 'text-blue-600 bg-blue-50 border-blue-200' },
              { label: 'Домашние задания',   icon: <ClipboardList size={16} />,  path: '/homeworks',   color: 'text-orange-600 bg-orange-50 border-orange-200' },
            ].map(l => (
              <button key={l.path} onClick={() => navigate(l.path)}
                className={cn('flex items-center gap-2 p-3 rounded-xl border text-sm font-medium hover:shadow-sm transition-all', l.color)}>
                {l.icon}{l.label}<ArrowRight size={13} className="ml-auto opacity-50" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ ПОЛЬЗОВАТЕЛИ ════════════════════════════════════════ */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500">{profiles.length} пользователей в системе</p>
            <button
              onClick={() => setCreateUserOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
            >
              <Plus size={15} />Создать пользователя
            </button>
          </div>

          {/* Search + role filter */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по имени или email..."
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
              {['all','student','teacher','curator','admin'].map(r => (
                <button key={r} onClick={() => setRoleFilter(r)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    roleFilter === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}>
                  {r === 'all' ? 'Все' : (ROLE_LABELS[r] || r)}
                </button>
              ))}
            </div>
          </div>

          {roleError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <ShieldAlert size={15} className="shrink-0" />{roleError}
            </div>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                    <th className="text-left pb-3 font-medium">Пользователь</th>
                    <th className="text-left pb-3 font-medium">Email</th>
                    <th className="text-left pb-3 font-medium">Роль</th>
                    <th className="text-left pb-3 font-medium">Регистрация</th>
                    <th className="text-right pb-3 font-medium">Профиль</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredProfiles.map(p => {
                    const link = p.student_id ? `/students/${p.student_id}`
                              : p.teacher_id ? `/teachers/${p.teacher_id}`
                              : null
                    const isSelf   = p.id === currentProfile?.id
                    const isOwner  = p.role === 'owner'
                    const canChange = !isSelf && (!isOwner || currentProfile?.role === 'owner')
                    const isSaving  = savingRole === p.id
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-3">
                          <div
                            onClick={() => link && navigate(link)}
                            className={cn('flex items-center gap-2.5', link && 'cursor-pointer')}
                          >
                            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold shrink-0 overflow-hidden">
                              {p.avatar_url
                                ? <img src={p.avatar_url} className="w-full h-full object-cover" alt="" />
                                : p.full_name.charAt(0)
                              }
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 truncate">{p.full_name}</div>
                              {isSelf && <div className="text-[10px] text-gray-400">это вы</div>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-gray-500 text-xs">{p.email}</td>
                        <td className="py-3">
                          {canChange ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={p.role}
                                disabled={isSaving}
                                onChange={e => changeRole(p.id, e.target.value)}
                                className={cn(
                                  'text-xs font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-primary-300 transition-colors',
                                  ROLE_COLORS[p.role] || 'bg-gray-100 text-gray-600',
                                  isSaving && 'opacity-50'
                                )}
                              >
                                {(['student','teacher','curator','admin',
                                  ...(currentProfile?.role === 'owner' ? ['owner'] : [])
                                ] as const).map(r => (
                                  <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                                ))}
                              </select>
                              {isSaving && <Loader2 size={12} className="animate-spin text-gray-400 shrink-0" />}
                            </div>
                          ) : (
                            <RoleBadge role={p.role} />
                          )}
                        </td>
                        <td className="py-3 text-gray-400 text-xs">
                          {new Date(p.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-3 text-right">
                          {link && (
                            <button
                              onClick={() => navigate(link)}
                              className="inline-flex items-center gap-1 text-xs text-primary-600 font-medium hover:text-primary-700"
                            >
                              {p.student_id ? <GraduationCap size={13} /> : <BookOpen size={13} />}
                              Профиль <ArrowRight size={11} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredProfiles.length === 0 && (
                <p className="text-center py-10 text-gray-400 text-sm">Нет результатов</p>
              )}
            </div>
          </Card>
          <p className="text-xs text-gray-400">Показано: {filteredProfiles.length} из {profiles.length}</p>
        </div>
      )}

      {/* ══ ГРУППЫ ══════════════════════════════════════════════ */}
      {tab === 'groups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{groups.length} групп · {groups.reduce((s, g) => s + g.student_count, 0)} учеников</p>
            <button onClick={() => navigate('/groups')}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
              <Users size={14} />Управление группами <ArrowRight size={13} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map(g => {
              const fill = g.max_students > 0 ? Math.min(Math.round(g.student_count / g.max_students * 100), 100) : 0
              return (
                <button
                  key={g.id}
                  onClick={() => navigate(`/groups/${g.id}`)}
                  className="text-left bg-white rounded-2xl border border-gray-200 p-5 hover:border-primary-300 hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{g.name}</div>
                      {g.course_title && <div className="text-xs text-primary-600 mt-0.5">{g.course_title}</div>}
                      {g.teacher_name && <div className="text-xs text-gray-400 mt-0.5">{g.teacher_name}</div>}
                    </div>
                    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full ml-2 shrink-0',
                      g.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                      {g.is_active ? 'Активна' : 'Закрыта'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {g.student_count} / {g.max_students} учеников
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={cn('h-2 rounded-full', fill >= 90 ? 'bg-red-400' : fill >= 70 ? 'bg-orange-400' : 'bg-primary-500')}
                      style={{ width: `${fill}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    {g.schedule_days && g.schedule_days.length > 0 ? (
                      <div className="flex items-center gap-1 text-xs text-gray-400 min-w-0">
                        <Calendar size={11} className="shrink-0" />
                        <span className="truncate">
                          {g.schedule_days.join(', ')}
                          {g.schedule_time && ` · ${g.schedule_time}`}
                        </span>
                      </div>
                    ) : <span />}
                    <span className="text-xs font-medium text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0 ml-2">
                      Подробнее <ArrowRight size={11} />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ КОМАНДА ════════════════════════════════════════════ */}
      {tab === 'staff' && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              Преподаватели и кураторы школы. Назначайте их в группы прямо отсюда.
            </p>
            <button
              onClick={() => setCreateUserOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
            >
              <Plus size={15} />Добавить сотрудника
            </button>
          </div>
          <StaffTab />
        </div>
      )}

      {/* ══ КУРСЫ ═══════════════════════════════════════════════ */}
      {tab === 'courses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-gray-500">{courses.length} курсов</p>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/course-program')}
                className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
                <BookOpen size={14} />Программа курсов <ArrowRight size={13} />
              </button>
              <button
                onClick={() => { setEditingCourse(null); setCourseModalOpen(true) }}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Plus size={14} />Новый курс
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map(c => {
              const av = getCourseAvailability(c)
              const enrollClosed = c.enrollment_open_until
                ? new Date().toISOString().slice(0, 10) > c.enrollment_open_until
                : false
              return (
                <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-primary-200 transition-all flex flex-col">
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{c.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {c.subject === 'physics' ? 'Физика' : c.subject === 'math' ? 'Математика' : c.subject || '—'}
                        {c.exam_type && ` · ${c.exam_type.toUpperCase()}`}
                      </div>
                    </div>
                    <AvailabilityBadge av={av} active={c.is_active} />
                  </div>

                  {c.description && (
                    <p className="text-xs text-gray-400 mb-3 line-clamp-2">{c.description}</p>
                  )}

                  {/* Date range */}
                  {(c.start_date || c.end_date) && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-3 px-2.5 py-1.5 bg-gray-50 rounded-lg">
                      <Calendar size={12} className="text-gray-400 shrink-0" />
                      <span className="truncate">
                        {c.start_date ? formatShortDate(c.start_date) : '?'} → {c.end_date ? formatShortDate(c.end_date) : '?'}
                      </span>
                    </div>
                  )}

                  {/* Enrollment closed warning */}
                  {enrollClosed && c.enrollment_open_until && (
                    <div className="flex items-center gap-1.5 text-xs text-orange-700 mb-3 px-2.5 py-1.5 bg-orange-50 rounded-lg">
                      <Lock size={12} className="shrink-0" />
                      <span className="truncate">Запись закрыта с {formatShortDate(c.enrollment_open_until)}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-auto">
                    {c.duration_weeks != null && (
                      <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                        <div className="font-bold text-gray-900">{c.duration_weeks}</div>
                        <div className="text-[10px] text-gray-400">недель</div>
                      </div>
                    )}
                    {c.price != null && (
                      <div className="bg-primary-50 rounded-xl p-2.5 text-center">
                        <div className="font-bold text-primary-700">
                          {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 }).format(c.price)}
                        </div>
                        <div className="text-[10px] text-gray-400">в месяц</div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => { setEditingCourse(c); setCourseModalOpen(true) }}
                    className="mt-3 flex items-center justify-center gap-1.5 w-full py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-200 rounded-xl transition-colors"
                  >
                    <Pencil size={13} />Редактировать
                  </button>
                </div>
              )
            })}
            {courses.length === 0 && (
              <div className="col-span-3 text-center py-12 text-gray-400">
                <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
                <p>Курсов пока нет</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Course edit modal */}
      <EditCourseModal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        onSaved={() => reload()}
        course={editingCourse}
      />

      {/* Create user modal */}
      <CreateUserModal
        open={createUserOpen}
        onClose={() => setCreateUserOpen(false)}
        onCreated={() => { setCreateUserOpen(false); reload() }}
      />

      {/* ══ ПОДПИСКИ ═════════════════════════════════════════════ */}
      {tab === 'subscriptions' && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по ученику или тарифу..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Активных',   value: subscriptions.filter(s => s.status === 'active').length,   cls: 'text-green-700 bg-green-50 border-green-200' },
              { label: 'Пробных',    value: subscriptions.filter(s => s.status === 'trial').length,    cls: 'text-blue-700 bg-blue-50 border-blue-200' },
              { label: 'Просроч.',   value: subscriptions.filter(s => s.status === 'past_due').length, cls: 'text-red-700 bg-red-50 border-red-200' },
              { label: 'Отменены',   value: subscriptions.filter(s => s.status === 'cancelled' || s.status === 'expired').length, cls: 'text-gray-600 bg-gray-50 border-gray-200' },
            ].map(item => (
              <div key={item.label} className={cn('rounded-2xl border p-4 text-center', item.cls)}>
                <div className="text-2xl font-bold">{item.value}</div>
                <div className="text-xs font-medium mt-0.5 opacity-70">{item.label}</div>
              </div>
            ))}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase border-b border-gray-100">
                    <th className="text-left pb-3 font-medium">Ученик</th>
                    <th className="text-left pb-3 font-medium">Тариф</th>
                    <th className="text-left pb-3 font-medium">Статус</th>
                    <th className="text-left pb-3 font-medium">Период до</th>
                    <th className="text-right pb-3 font-medium">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredSubs.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3">
                        <div className="font-medium text-gray-900">{s.student_name}</div>
                      </td>
                      <td className="py-3">
                        <div className="text-gray-700">{s.plan_name}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          {s.auto_renew
                            ? <><RefreshCw size={10} className="text-green-500" />Автопродление</>
                            : <><AlertCircle size={10} className="text-orange-400" />Отменяется</>
                          }
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', SUB_COLORS[s.status] || 'bg-gray-100 text-gray-500')}>
                          {SUB_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-gray-500">
                        {s.period_end
                          ? new Date(s.period_end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'
                        }
                      </td>
                      <td className="py-3 text-right font-semibold text-gray-900">
                        {fmtRub(s.amount)}
                        <div className="text-[10px] font-normal text-gray-400">
                          {s.billing_period === 'month' ? '/ мес' : s.billing_period === 'year' ? '/ год' : 'разово'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSubs.length === 0 && (
                <p className="text-center py-10 text-gray-400 text-sm">Нет подписок</p>
              )}
            </div>
          </Card>
          <p className="text-xs text-gray-400">Показано: {filteredSubs.length} из {subscriptions.length}</p>
        </div>
      )}

    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────
function AvailabilityBadge({ av, active }: { av: ReturnType<typeof getCourseAvailability>; active: boolean }) {
  if (!active) {
    return <span className="text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">Скрыт</span>
  }
  const map = {
    active:   { label: 'Идёт',      cls: 'bg-green-100 text-green-700' },
    upcoming: { label: 'Скоро',     cls: 'bg-blue-100  text-blue-700' },
    ended:    { label: 'Завершён',  cls: 'bg-gray-100  text-gray-500' },
    undated:  { label: 'Без дат',   cls: 'bg-amber-100 text-amber-700' },
  } as const
  const { label, cls } = map[av]
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
}
