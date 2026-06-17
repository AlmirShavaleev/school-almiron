import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Users, Calendar, BookOpen, GraduationCap, Video,
  ClipboardList, ChevronRight, AlertCircle, Loader2, Mail, Phone,
  Star, CheckCircle2, Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDate } from '@/utils/format'

interface TeacherFull {
  id:        string
  bio:       string | null
  rating:    number
  hourly_rate: number | null
  subjects:  string[] | null
  created_at: string
  profile: {
    id:         string
    full_name:  string
    email:      string
    phone:      string | null
    avatar_url: string | null
    created_at: string
  }
}

interface TeacherGroup {
  id:            string
  name:          string
  is_active:     boolean
  max_students:  number
  student_count: number
  course_title:  string | null
  schedule_days: string[] | null
  schedule_time: string | null
}

interface TeacherLesson {
  id:               string
  title:            string
  scheduled_at:     string
  duration_minutes: number | null
  status:           string
  group_name:       string
  group_id:         string
}

interface TeacherHW {
  id:           string
  title:        string
  due_date:     string
  group_name:   string
  group_id:     string
  total:        number
  submitted:    number
  pending:      number
}

export function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [teacher,   setTeacher]   = useState<TeacherFull | null>(null)
  const [groups,    setGroups]    = useState<TeacherGroup[]>([])
  const [lessons,   setLessons]   = useState<TeacherLesson[]>([])
  const [homeworks, setHomeworks] = useState<TeacherHW[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)

    load()
      .catch(e => { if (!cancelled) setError(e.message || 'Ошибка загрузки') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }

    async function load() {
      // Round 1: teacher + groups + lessons + homeworks
      const [tRes, gRes, lRes, hRes] = await Promise.all([
        supabase.from('teachers')
          .select('id, bio, rating, hourly_rate, subjects, created_at, profiles(id, full_name, email, phone, avatar_url, created_at)')
          .eq('id', id!)
          .single(),

        supabase.from('groups')
          .select('id, name, is_active, max_students, schedule_days, schedule_time, group_students(count), courses(title)')
          .eq('teacher_id', id!)
          .order('name'),

        supabase.from('lessons')
          .select('id, title, scheduled_at, duration_minutes, status, group_id, groups(name)')
          .eq('teacher_id', id!)
          .order('scheduled_at', { ascending: false })
          .limit(20),

        supabase.from('homeworks')
          .select('id, title, due_date, group_id, groups(name)')
          .eq('created_by', id!)
          .order('due_date', { ascending: false })
          .limit(20),
      ])

      if (tRes.error) throw tRes.error
      if (cancelled) return

      const t: any = tRes.data
      const builtTeacher: TeacherFull = {
        id:          t.id,
        bio:         t.bio,
        rating:      t.rating || 0,
        hourly_rate: t.hourly_rate,
        subjects:    t.subjects,
        created_at:  t.created_at,
        profile: {
          id:         t.profiles.id,
          full_name:  t.profiles.full_name || '—',
          email:      t.profiles.email || '',
          phone:      t.profiles.phone,
          avatar_url: t.profiles.avatar_url,
          created_at: t.profiles.created_at,
        },
      }

      const rawHW = hRes.data || []
      const hwIds = rawHW.map((h: any) => h.id)

      // Round 2: HW submissions count to compute "pending"
      const { data: subs } = hwIds.length
        ? await supabase.from('homework_submissions').select('homework_id, status').in('homework_id', hwIds)
        : { data: [] as any[] }
      if (cancelled) return

      const builtGroups: TeacherGroup[] = (gRes.data || []).map((g: any) => ({
        id:            g.id,
        name:          g.name,
        is_active:     g.is_active !== false,
        max_students:  g.max_students || 15,
        student_count: g.group_students?.[0]?.count || 0,
        course_title:  g.courses?.title || null,
        schedule_days: g.schedule_days,
        schedule_time: g.schedule_time,
      }))

      const builtLessons: TeacherLesson[] = (lRes.data || []).map((l: any) => ({
        id: l.id, title: l.title, scheduled_at: l.scheduled_at,
        duration_minutes: l.duration_minutes, status: l.status,
        group_name: l.groups?.name || '—', group_id: l.group_id,
      }))

      const builtHW: TeacherHW[] = rawHW.map((hw: any) => {
        const my = (subs || []).filter((s: any) => s.homework_id === hw.id)
        const submitted = my.filter((s: any) => ['submitted', 'checked'].includes(s.status)).length
        const pending   = my.filter((s: any) => s.status === 'submitted').length
        return {
          id: hw.id, title: hw.title, due_date: hw.due_date,
          group_name: hw.groups?.name || '—', group_id: hw.group_id,
          total: my.length, submitted, pending,
        }
      })

      setTeacher(builtTeacher)
      setGroups(builtGroups)
      setLessons(builtLessons)
      setHomeworks(builtHW)
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-600" />
        <span className="text-gray-500 text-sm">Загружаем профиль учителя…</span>
      </div>
    )
  }

  if (error || !teacher) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-red-400" />
        <p className="text-gray-700">{error || 'Учитель не найден'}</p>
        <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline">Назад</button>
      </div>
    )
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const now = new Date()
  const totalStudents = groups.reduce((s, g) => s + g.student_count, 0)
  const upcomingLessons = lessons.filter(l => new Date(l.scheduled_at) > now)
  const completedLessons = lessons.filter(l => new Date(l.scheduled_at) <= now)
  const totalPendingHW = homeworks.reduce((s, h) => s + h.pending, 0)
  const totalHWSubmissions = homeworks.reduce((s, h) => s + h.submitted, 0)
  const totalHWExpected    = homeworks.reduce((s, h) => s + h.total, 0)
  const hwRate = totalHWExpected > 0 ? Math.round(totalHWSubmissions / totalHWExpected * 100) : 0

  const subjectLabels: Record<string, string> = { physics: 'Физика', math: 'Математика' }

  return (
    <div className="space-y-5">

      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft size={15} />Назад
      </button>

      {/* Hero header */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-4 flex-wrap">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-bold overflow-hidden shrink-0">
            {teacher.profile.avatar_url
              ? <img src={teacher.profile.avatar_url} className="w-full h-full object-cover" alt="" />
              : teacher.profile.full_name.charAt(0).toUpperCase()
            }
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-bold">{teacher.profile.full_name}</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/25">Преподаватель</span>
            </div>

            {teacher.subjects && teacher.subjects.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {teacher.subjects.map(s => (
                  <span key={s} className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/15">
                    {subjectLabels[s] || s}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90">
              {teacher.profile.email && (
                <a href={`mailto:${teacher.profile.email}`} className="inline-flex items-center gap-1.5 hover:text-white">
                  <Mail size={13} />{teacher.profile.email}
                </a>
              )}
              {teacher.profile.phone && (
                <a href={`tel:${teacher.profile.phone}`} className="inline-flex items-center gap-1.5 hover:text-white">
                  <Phone size={13} />{teacher.profile.phone}
                </a>
              )}
            </div>

            <div className="text-xs text-white/70 mt-2">
              В команде с {formatDate(teacher.profile.created_at || teacher.created_at)}
            </div>
          </div>

          {/* Rating + rate */}
          <div className="text-right shrink-0">
            {teacher.rating > 0 && (
              <div className="flex items-center justify-end gap-1 text-2xl font-bold">
                <Star size={18} className="text-amber-300 fill-amber-300" />
                {teacher.rating.toFixed(1)}
              </div>
            )}
            {teacher.hourly_rate != null && (
              <div className="text-xs text-white/80 mt-1">
                {new Intl.NumberFormat('ru-RU').format(teacher.hourly_rate)} ₽/час
              </div>
            )}
          </div>
        </div>

        {teacher.bio && (
          <p className="mt-4 text-sm text-white/90 leading-relaxed">{teacher.bio}</p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard title="Групп"        value={groups.length}    icon={<Users size={20} />}        color="blue" />
        <StatCard title="Учеников"     value={totalStudents}    icon={<GraduationCap size={20} />} color="purple" />
        <StatCard
          title="Сдача ДЗ"
          value={`${hwRate}%`}
          icon={<ClipboardList size={20} />}
          color={hwRate >= 80 ? 'green' : hwRate >= 60 ? 'orange' : 'red'}
        />
        <StatCard
          title="На проверке"
          value={totalPendingHW}
          icon={<Clock size={20} />}
          color={totalPendingHW > 0 ? 'orange' : 'green'}
          subtitle={totalPendingHW === 0 ? 'Всё проверено 🎉' : 'ждут оценки'}
        />
      </div>

      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users size={17} />Группы ({groups.length})</CardTitle>
        </CardHeader>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Учитель не ведёт групп</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map(g => {
              const fill = g.max_students > 0 ? Math.min(Math.round(g.student_count / g.max_students * 100), 100) : 0
              return (
                <Link
                  key={g.id}
                  to={`/groups/${g.id}`}
                  className="block p-4 rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate group-hover:text-primary-700">{g.name}</div>
                      {g.course_title && <div className="text-xs text-primary-600 truncate">{g.course_title}</div>}
                    </div>
                    <Badge variant={g.is_active ? 'success' : 'default'} className="text-xs shrink-0">
                      {g.is_active ? 'Активна' : 'Закрыта'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                    <span>{g.student_count}/{g.max_students} учеников</span>
                    <span>{fill}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full',
                      fill >= 90 ? 'bg-red-400' : fill >= 70 ? 'bg-orange-400' : 'bg-primary-500')}
                      style={{ width: `${fill}%` }} />
                  </div>
                  {g.schedule_days && g.schedule_days.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 mt-2">
                      <Calendar size={11} />{g.schedule_days.join(', ')}{g.schedule_time && ` · ${g.schedule_time}`}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      {/* Lessons + Homeworks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Video size={17} />Занятия</CardTitle>
            <span className="text-xs text-gray-400">{completedLessons.length} · {upcomingLessons.length} впереди</span>
          </CardHeader>
          {lessons.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Занятий не было</p>
          ) : (
            <div className="space-y-0">
              {lessons.slice(0, 8).map(l => {
                const past = new Date(l.scheduled_at) < now
                return (
                  <Link
                    key={l.id}
                    to={`/lessons/${l.id}`}
                    className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className={cn('w-2 h-2 rounded-full shrink-0', past ? 'bg-gray-300' : 'bg-blue-500')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{l.title}</div>
                      <div className="text-xs text-gray-400">
                        {formatDateTime(l.scheduled_at)} · {l.group_name}
                      </div>
                    </div>
                    {l.status === 'completed' && <Badge variant="success" className="text-xs shrink-0">Завершено</Badge>}
                    {l.status === 'cancelled' && <Badge variant="default" className="text-xs shrink-0">Отменено</Badge>}
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList size={17} />Домашние задания</CardTitle>
            {totalPendingHW > 0 && <Badge variant="warning" className="text-xs">{totalPendingHW} на проверке</Badge>}
          </CardHeader>
          {homeworks.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">ДЗ не выдавалось</p>
          ) : (
            <div className="space-y-0">
              {homeworks.slice(0, 8).map(hw => {
                const overdue = new Date(hw.due_date) < now
                const pct = hw.total > 0 ? Math.round(hw.submitted / hw.total * 100) : 0
                return (
                  <Link
                    key={hw.id}
                    to={`/homeworks/${hw.id}`}
                    className="block py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{hw.title}</div>
                        <div className={cn('text-xs mt-0.5',
                            overdue ? 'text-red-500 font-medium' : 'text-gray-400')}
                        >
                          {overdue ? '🔴 Истёк ' : 'до '}{formatDate(hw.due_date)} · {hw.group_name}
                        </div>
                      </div>
                      <div className="text-xs text-right shrink-0">
                        <span className="font-semibold text-gray-900">{hw.submitted}</span>
                        <span className="text-gray-400">/{hw.total}</span>
                        {hw.pending > 0 && (
                          <span className="block text-orange-600 font-medium mt-0.5">{hw.pending} не пров.</span>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full',
                        pct === 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : 'bg-orange-400')}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
