import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, BookOpen, BarChart3, Search, ArrowRight,
  CheckCircle, RefreshCw, Calendar, Activity, Bell, ListChecks,
  GraduationCap, Plus, Pencil, Lock, UserX, UserPlus,
  Loader2, ShieldAlert, ClipboardList, Send,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { StaffTab } from '@/components/admin/StaffTab'
import { CreateUserModal } from '@/components/modals/CreateUserModal'
import { QuickLogin } from '@/components/demo/QuickLogin'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useAdminDashboard, type AdminCourse } from '@/hooks/useAdminDashboard'
import { useSchoolStats } from '@/hooks/useSchoolStats'
import { useSchoolAnalytics, DORMANT_DAYS } from '@/hooks/useSchoolAnalytics'
import { DormantPanel, LearningPanel } from '@/components/admin/SchoolActivity'
import { useVercelAnalytics } from '@/hooks/useVercelAnalytics'
import { VideoStatsTab } from '@/components/admin/VideoStats'
import { SiteAnalytics } from '@/components/admin/SiteAnalytics'
import { EditCourseModal } from '@/components/modals/EditCourseModal'
import { getCourseAvailability } from '@/types'
import { cn } from '@/utils/cn'
import { ROLE_LABELS, formatTime } from '@/utils/format'

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

// ─── Tabs ─────────────────────────────────────────────────────────────────────
// Вкладки собраны по вопросам, которые владелец задаёт, а не по таблицам базы.
// «Обзор» отвечает «что делать сегодня», «Ученики» — «что с людьми», «Учёба» —
// «как идёт процесс», три последних — три независимых источника чисел.
//
// Девять плиток, висевших НАД вкладками, разъехались по ним: общая полка над
// содержимым заставляла читать все девять чисел на любой вкладке, а отвечали
// они на разные вопросы. Числа те же и считает их та же RPC — сменилось только
// место.
//
// Вкладки «Группы» и «Подписки» убраны по решению владельца 2026-08-04:
// группы — потому что действует закон «один курс = одна группа» (§61/§64) и
// слово «группа» уходит из интерфейса; подписки — потому что денежный контур
// не запущен, в `subscriptions` ноль строк. Обе решения продуктовые, а не
// технические: код удалён, данные не тронуты.
type Tab = 'now' | 'overview' | 'students' | 'learning' | 'site' | 'video' | 'staff'
const TABS: { key: Tab; label: string }[] = [
  // «Сейчас» — место под живую панель школы, её делает отдельная работа. Место
  // занято намеренно: порядок вкладок утверждён владельцем целиком, и вставлять
  // первую вкладку позже значило бы двигать все остальные.
  { key: 'now',      label: 'Сейчас' },
  { key: 'overview', label: 'Обзор' },
  { key: 'students', label: 'Ученики' },
  { key: 'learning', label: 'Учёба' },
  // «Сайт» отдельной вкладкой, а не блоком в «Обзоре»: рядом живут школьные
  // срезы §107, и «сколько заходов» там и здесь — разные числа из разных
  // источников. На одном экране их спутают.
  { key: 'site',     label: 'Сайт' },
  // «Видео» — по тому же доводу третий независимый источник чисел: просмотры
  // роликов у Bunny, и с посещениями сайта они не складываются.
  { key: 'video',    label: 'Видео' },
  { key: 'staff',    label: 'Команда' },
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

  const { profiles, groups, courses, stats, loading, reload } = useAdminDashboard()
  const { stats: school, error: schoolError, fetchedAt: schoolAt, reload: reloadSchool } = useSchoolStats()
  const analytics = useSchoolAnalytics()
  const site = useVercelAnalytics()

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

  // ── Список дел ────────────────────────────────────────────────────────────
  // Строка появляется, только когда есть что делать. Ноль — это не «дело на
  // ноль штук», а отсутствие дела, и рисовать его строкой значило бы выдавать
  // спокойный день за работу.
  const todo = useMemo(() => {
    const rows: { key: string; icon: React.ReactNode; label: string; hint?: string; count: number; go: () => void; tone: string }[] = []

    if (school && school.homework_pending > 0) {
      rows.push({
        key: 'pending',
        icon: <ClipboardList size={18} />,
        label: 'Проверить работы',
        // «Ждёт N дней» и «сколько ждут» — два числа об одной очереди, поэтому
        // приходят из одной RPC. null означает пустую очередь, а не ноль дней,
        // и до сюда он просто не доходит: строки при пустой очереди нет.
        hint: school.homework_oldest_pending_days != null
          ? `самая старая ждёт ${school.homework_oldest_pending_days} дн.`
          : undefined,
        count: school.homework_pending,
        go: () => navigate('/homework-queue'),
        tone: 'text-orange-600 bg-orange-50 border-orange-200',
      })
    }

    if (analytics.dormant.length > 0) {
      rows.push({
        key: 'dormant',
        icon: <UserX size={18} />,
        label: 'Написать пропавшим',
        hint: `не заходили ${DORMANT_DAYS}+ дней`,
        count: analytics.dormant.length,
        go: () => setTab('students'),
        tone: 'text-red-600 bg-red-50 border-red-200',
      })
    }

    if ((stats?.new_users_week ?? 0) > 0) {
      rows.push({
        key: 'newcomers',
        icon: <UserPlus size={18} />,
        label: 'Встретить новичков',
        hint: 'зарегистрировались за неделю',
        count: stats?.new_users_week ?? 0,
        go: () => { setTab('students'); setRoleFilter('all') },
        tone: 'text-primary-600 bg-primary-50 border-primary-200',
      })
    }

    return rows
  }, [school, analytics.dormant.length, stats?.new_users_week, navigate])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Панель администратора</h1>
          <p className="text-gray-500 mt-0.5">Управление школой · {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button onClick={() => { reload(); reloadSchool(); analytics.reload() }} className="min-h-11 flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <RefreshCw size={14} />Обновить
        </button>
      </div>

      {/* ── Быстрый вход (демо impersonation) ─────────────────────── */}
      <QuickLogin />

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSearch('') }}
            className={cn(
              'min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Отказ RPC школьных чисел — один на все вкладки, которые ими живут.
          Показываем словами, а не нулями: молчащий дашборд неотличим от школы,
          в которой ничего не происходит (уроки §47 и §54). */}
      {schoolError && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          {schoolError}
        </div>
      )}

      {/* ══ СЕЙЧАС ══════════════════════════════════════════════ */}
      {tab === 'now' && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-10 text-center">
          <p className="text-sm text-gray-500">Живая панель школы готовится отдельной работой.</p>
          <p className="mt-1 text-xs text-gray-400">
            Пока смотрите «Обзор» — там список дел на сегодня.
          </p>
        </div>
      )}

      {/* ══ ОБЗОР ════════════════════════════════════════════════
          Не витрина, а список дел: «что сделать → сколько → куда идти».
          Все числа читаются из уже существующих источников, ни одно не
          пересчитывается здесь заново. */}
      {tab === 'overview' && (
        <div className="space-y-4">

          {todo.length === 0 ? (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-8 text-center">
              <CheckCircle size={26} className="mx-auto mb-2 text-green-600" />
              <p className="text-sm font-medium text-green-800">На сегодня всё разобрано.</p>
              <p className="mt-1 text-xs text-green-700">
                Непроверенных работ нет, пропавших нет, новичков за неделю не появилось.
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="admin-todo">
              {todo.map(row => (
                <button
                  key={row.key}
                  onClick={row.go}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:shadow-sm',
                    row.tone,
                  )}
                >
                  <span className="shrink-0">{row.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{row.label}</span>
                    {row.hint && <span className="block text-xs opacity-70">{row.hint}</span>}
                  </span>
                  <span className="shrink-0 text-2xl font-bold tabular-nums">{row.count}</span>
                  <ArrowRight size={16} className="shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          )}

          {/* Пульс дня — не дело, а справка: сколько сдали и сколько зашли
              сегодня. Ноль здесь ноль и есть, а не «нет данных». */}
          <Card>
            <CardHeader>
              <CardTitle>Сегодня</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <span className="text-sm text-gray-600">
                Сдано работ: <b className="text-lg text-gray-900 tabular-nums">{school?.homework_submitted_today ?? 0}</b>
              </span>
              <span className="text-sm text-gray-600">
                Заходили: <b className="text-lg text-gray-900 tabular-nums">{school?.visits_today ?? 0}</b>
              </span>
            </div>
            <SourceNote at={schoolAt} />
          </Card>
        </div>
      )}

      {/* ══ УЧЕНИКИ ═════════════════════════════════════════════ */}
      {tab === 'students' && (
        <div className="space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Учеников"
              value={school?.students ?? 0}
              icon={<Users size={20} />}
              color="blue"
              subtitle={`+${stats?.new_users_week ?? 0} новых за неделю`}
            />
            <StatCard
              title="Заходили за неделю"
              value={school?.visits_7d ?? 0}
              icon={<Activity size={20} />}
              color="orange"
              subtitle={`сегодня — ${school?.visits_today ?? 0}`}
            />
            <StatCard
              title="Привязано Telegram"
              value={school?.telegram_connected ?? 0}
              icon={<Bell size={20} />}
              color="indigo"
              subtitle={`из ${stats?.total_users ?? 0} профилей`}
            />
          </div>
          <SourceNote at={schoolAt} />

          {/* «Кто пропал» — единственный блок, который подсказывает действие:
              кому написать сегодня. Стоит здесь, а не среди учебных срезов,
              потому что это вопрос про людей. */}
          <DormantPanel
            dormant={analytics.dormant}
            loading={analytics.loading}
            error={analytics.error}
          />
          <SourceNote at={analytics.fetchedAt} />

          {/* Recent registrations + groups overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Новые пользователи</CardTitle>
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
                {profiles.length === 0 && (
                  <p className="py-4 text-center text-sm text-gray-400">Пользователей пока нет.</p>
                )}
              </div>
            </Card>

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

          {/* Разбивка по ролям. Кнопки не переключают вкладку — они ставят
              фильтр таблице, которая стоит тут же. `owner` из разбивки убран
              (решение владельца 04.08): роли нет ни у одного профиля, плитка
              была вечным нулём. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['student','teacher','curator','admin'] as const).map(role => {
              const count = profiles.filter(p => p.role === role).length
              return (
                <button
                  key={role}
                  onClick={() => setRoleFilter(role)}
                  className={cn(
                    'bg-white rounded-2xl border p-4 text-center hover:shadow-sm transition-all group',
                    roleFilter === role ? 'border-primary-400' : 'border-gray-200 hover:border-primary-300',
                  )}
                >
                  <div className="text-2xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{count}</div>
                  <RoleBadge role={role} />
                </button>
              )
            })}
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
                  className={cn('min-h-11 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
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

          <button onClick={() => navigate('/admin/telegram')}
            className="flex items-center gap-2 p-3 rounded-xl border text-sm font-medium hover:shadow-sm transition-all text-sky-600 bg-sky-50 border-sky-200">
            <Send size={16} />Telegram-журнал<ArrowRight size={13} className="ml-auto opacity-50" />
          </button>
        </div>
      )}

      {/* ══ УЧЁБА ═══════════════════════════════════════════════ */}
      {tab === 'learning' && (
        <div className="space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatCard
              title="Курсов"
              value={school?.courses ?? 0}
              icon={<BookOpen size={20} />}
              color="green"
            />
            <StatCard
              title="Сдано ДЗ за 7 дней"
              value={school?.homework_submitted_7d ?? 0}
              icon={<Send size={20} />}
              color="indigo"
              subtitle={`${school?.homework_submitted_total ?? 0} за всё время`}
            />
            <StatCard
              title="Проверено работ"
              value={school?.homework_reviewed ?? 0}
              icon={<CheckCircle size={20} />}
              color="green"
            />
            <StatCard
              title="Ждут проверки"
              value={school?.homework_pending ?? 0}
              icon={<ClipboardList size={20} />}
              color={school && school.homework_pending > 0 ? 'orange' : 'green'}
              subtitle={school?.homework_pending ? 'Ждут учителей' : 'Все проверены'}
              onClick={() => navigate('/homework-queue')}
            />
            <StatCard
              title="Пройдено тестирований"
              value={school?.variants_completed ?? 0}
              icon={<ListChecks size={20} />}
              color="purple"
            />
          </div>
          <SourceNote at={schoolAt} />

          {/* Заходы по дням, воронка ДЗ и «что не открывают» — наблюдение за
              учебным процессом. «Кто пропал» уехал на «Учеников»: он про людей
              и подсказывает действие. */}
          <LearningPanel
            activity={analytics.activity}
            unopened={analytics.unopened}
            funnel={analytics.funnel}
            viewHealth={analytics.viewHealth}
            hasViewData={analytics.hasViewData}
            loading={analytics.loading}
            error={analytics.error}
          />
          <SourceNote at={analytics.fetchedAt} />

          <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { label: 'Пробники',         icon: <BarChart3 size={16} />,     path: '/mock-exams', color: 'text-purple-600 bg-purple-50 border-purple-200' },
              { label: 'Домашние задания', icon: <ClipboardList size={16} />, path: '/homeworks',  color: 'text-orange-600 bg-orange-50 border-orange-200' },
            ].map(l => (
              <button key={l.path} onClick={() => navigate(l.path)}
                className={cn('flex items-center gap-2 p-3 rounded-xl border text-sm font-medium hover:shadow-sm transition-all', l.color)}>
                {l.icon}{l.label}<ArrowRight size={13} className="ml-auto opacity-50" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ САЙТ ════════════════════════════════════════════════ */}
      {tab === 'site' && <SiteAnalytics {...site} />}

      {/* ══ ВИДЕО ═══════════════════════════════════════════════ */}
      {tab === 'video' && <VideoStatsTab />}

      {/* ══ КОМАНДА ═════════════════════════════════════════════ */}
      {tab === 'staff' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              title="Учителей"
              value={school?.teachers ?? 0}
              icon={<GraduationCap size={20} />}
              color="blue"
            />
          </div>
          <SourceNote at={schoolAt} />

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

    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Подпись под блоком: откуда число и на когда.
 *
 * На соседних вкладках живут числа Vercel и Bunny — со своими кэшами и своей
 * свежестью. Без подписи «сколько заходов» с трёх вкладок читается как одно и
 * то же число, и разница объясняется поломкой, а не разными источниками.
 */
function SourceNote({ at, source = 'Наша база' }: { at: string | null | undefined; source?: string }) {
  return (
    <p className="text-xs text-gray-400" data-testid="source-note">
      {source} · {at ? `данные на ${safeTime(at)}` : 'время получения неизвестно'}
    </p>
  )
}

function safeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return formatTime(d)
}

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
