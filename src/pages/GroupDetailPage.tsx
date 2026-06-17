import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Users, Calendar, Clock, BookOpen, GraduationCap, UserCheck,
  Video, ClipboardList, ChevronRight, AlertCircle, Loader2, TrendingUp,
  CheckCircle2, XCircle, Trophy, Mail, Phone,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDate } from '@/utils/format'

interface GroupFull {
  id:            string
  name:          string
  is_active:     boolean
  max_students:  number
  schedule_days: string[] | null
  schedule_time: string | null
  created_at:    string
  course:        { id: string; title: string; subject: string | null; exam_type: string | null; start_date: string | null; end_date: string | null } | null
  teacher:       { id: string; profile: { id: string; full_name: string; email: string; phone: string | null; avatar_url: string | null } } | null
  curator:       { id: string; profile: { id: string; full_name: string; email: string; phone: string | null; avatar_url: string | null } } | null
}

interface GroupStudent {
  id:         string
  profile_id: string
  full_name:  string
  avatar_url: string | null
  email:      string
  xp_points:  number
  league:     string
  grade:      number | null
  // computed
  att_rate:   number
  hw_done:    number
  hw_total:   number
}

interface GroupLesson {
  id:               string
  title:            string
  scheduled_at:     string
  duration_minutes: number | null
  status:           string
  zoom_link:        string | null
}

interface GroupHW {
  id:         string
  title:      string
  due_date:   string
  submitted:  number
  total:      number
}

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [group,     setGroup]     = useState<GroupFull | null>(null)
  const [students,  setStudents]  = useState<GroupStudent[]>([])
  const [lessons,   setLessons]   = useState<GroupLesson[]>([])
  const [homeworks, setHomeworks] = useState<GroupHW[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)

    load(id)
      .catch(e => { if (!cancelled) setError(e.message || 'Ошибка загрузки') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }

    async function load(gid: string) {
      // ── Round 1: group + students + lessons + homeworks (parallel) ─────────
      const [gRes, gsRes, lRes, hRes] = await Promise.all([
        supabase.from('groups')
          .select(`
            id, name, is_active, max_students, schedule_days, schedule_time, created_at,
            courses(id, title, subject, exam_type, start_date, end_date),
            teachers(id, profiles(id, full_name, email, phone, avatar_url)),
            curators(id, profiles(id, full_name, email, phone, avatar_url))
          `)
          .eq('id', gid)
          .single(),

        supabase.from('group_students')
          .select('students(id, profile_id, xp_points, league, grade, profiles(full_name, email, avatar_url))')
          .eq('group_id', gid),

        supabase.from('lessons')
          .select('id, title, scheduled_at, duration_minutes, status, zoom_link')
          .eq('group_id', gid)
          .order('scheduled_at', { ascending: false })
          .limit(50),

        supabase.from('homeworks')
          .select('id, title, due_date')
          .eq('group_id', gid)
          .order('due_date', { ascending: false })
          .limit(30),
      ])

      if (gRes.error) throw gRes.error
      if (cancelled) return

      const g: any = gRes.data
      const builtGroup: GroupFull = {
        id:            g.id,
        name:          g.name,
        is_active:     g.is_active !== false,
        max_students:  g.max_students || 15,
        schedule_days: g.schedule_days,
        schedule_time: g.schedule_time,
        created_at:    g.created_at,
        course:        g.courses ? {
          id: g.courses.id, title: g.courses.title,
          subject: g.courses.subject, exam_type: g.courses.exam_type,
          start_date: g.courses.start_date, end_date: g.courses.end_date,
        } : null,
        teacher:       g.teachers ? { id: g.teachers.id, profile: g.teachers.profiles } : null,
        curator:       g.curators ? { id: g.curators.id, profile: g.curators.profiles } : null,
      }

      const rawStudents: any[] = (gsRes.data || []).map((r: any) => r.students).filter(Boolean)
      const studentIds = rawStudents.map(s => s.id)
      const rawLessons: any[] = lRes.data || []
      const rawHW: any[] = hRes.data || []

      const lessonIds = rawLessons.map(l => l.id)
      const hwIds = rawHW.map(h => h.id)

      // ── Round 2: attendance + submissions (parallel) ──────────────────────
      const [attRes, subRes] = await Promise.all([
        studentIds.length && lessonIds.length
          ? supabase.from('attendance').select('student_id, lesson_id, status')
              .in('student_id', studentIds).in('lesson_id', lessonIds)
          : Promise.resolve({ data: [] as any[] }),
        studentIds.length && hwIds.length
          ? supabase.from('homework_submissions').select('student_id, homework_id, status')
              .in('student_id', studentIds).in('homework_id', hwIds)
          : Promise.resolve({ data: [] as any[] }),
      ])
      if (cancelled) return

      const attData = attRes.data || []
      const subData = subRes.data || []

      // Per-student stats
      const builtStudents: GroupStudent[] = rawStudents.map((s: any) => {
        const myAtt = attData.filter((a: any) => a.student_id === s.id)
        const present = myAtt.filter((a: any) => a.status === 'present' || a.status === 'late').length
        const attRate = myAtt.length > 0 ? Math.round(present / myAtt.length * 100) : 0

        const mySubs = subData.filter((sub: any) => sub.student_id === s.id)
        const done = mySubs.filter((sub: any) => ['submitted','checked'].includes(sub.status)).length

        return {
          id:         s.id,
          profile_id: s.profile_id,
          full_name:  s.profiles?.full_name || '—',
          email:      s.profiles?.email || '',
          avatar_url: s.profiles?.avatar_url || null,
          xp_points:  s.xp_points || 0,
          league:     s.league || 'bronze',
          grade:      s.grade,
          att_rate:   attRate,
          hw_done:    done,
          hw_total:   rawHW.length,
        }
      }).sort((a, b) => b.xp_points - a.xp_points)

      // Per-HW stats
      const builtHW: GroupHW[] = rawHW.map((hw: any) => {
        const subs = subData.filter((s: any) => s.homework_id === hw.id)
        const sent = subs.filter((s: any) => ['submitted','checked'].includes(s.status)).length
        return {
          id:        hw.id,
          title:     hw.title,
          due_date:  hw.due_date,
          submitted: sent,
          total:     studentIds.length,
        }
      })

      setGroup(builtGroup)
      setStudents(builtStudents)
      setLessons(rawLessons)
      setHomeworks(builtHW)
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-600" />
        <span className="text-gray-500 text-sm">Загружаем группу…</span>
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-red-400" />
        <p className="text-gray-700">{error || 'Группа не найдена'}</p>
        <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline">Назад</button>
      </div>
    )
  }

  // ── computed totals ───────────────────────────────────────────────────────
  const fill = group.max_students > 0
    ? Math.min(Math.round(students.length / group.max_students * 100), 100) : 0
  const now = new Date()
  const upcoming = lessons.filter(l => new Date(l.scheduled_at) > now)
  const completed = lessons.filter(l => new Date(l.scheduled_at) <= now)
  const avgAttRate = students.length > 0
    ? Math.round(students.reduce((s, st) => s + st.att_rate, 0) / students.length) : 0
  const totalSubmissions = students.reduce((s, st) => s + st.hw_done, 0)
  const totalExpected = students.length * homeworks.length
  const avgHwRate = totalExpected > 0 ? Math.round(totalSubmissions / totalExpected * 100) : 0

  return (
    <div className="space-y-5">

      {/* Back nav */}
      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft size={15} />Назад
      </button>

      {/* Header */}
      <div className="bg-gradient-to-br from-primary-600 to-purple-600 text-white rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold truncate">{group.name}</h1>
              <span className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                group.is_active ? 'bg-white/25 text-white' : 'bg-gray-900/30 text-white/80'
              )}>
                {group.is_active ? 'Активна' : 'Закрыта'}
              </span>
            </div>
            {group.course && (
              <Link to="/course-program" className="text-sm text-white/90 hover:text-white inline-flex items-center gap-1">
                <BookOpen size={13} />{group.course.title}
              </Link>
            )}
            <div className="text-xs text-white/70 mt-1">Создана {formatDate(group.created_at)}</div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-3xl font-extrabold">{students.length}<span className="text-white/60 text-xl">/{group.max_students}</span></div>
            <div className="text-xs text-white/80">учеников · заполнено {fill}%</div>
          </div>
        </div>

        {/* Schedule strip */}
        {(group.schedule_days?.length || group.schedule_time) && (
          <div className="flex items-center gap-2 mt-4 text-sm bg-white/15 rounded-xl px-3 py-2 w-fit">
            <Calendar size={14} />
            <span>{group.schedule_days?.join(', ') || '—'}</span>
            {group.schedule_time && <><Clock size={13} className="ml-2" /><span>{group.schedule_time}</span></>}
          </div>
        )}
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Средняя посещаемость"
          value={`${avgAttRate}%`}
          icon={<UserCheck size={20} />}
          color={avgAttRate >= 80 ? 'green' : avgAttRate >= 60 ? 'orange' : 'red'}
        />
        <StatCard
          title="Сдача ДЗ"
          value={`${avgHwRate}%`}
          icon={<ClipboardList size={20} />}
          color={avgHwRate >= 80 ? 'green' : avgHwRate >= 60 ? 'orange' : 'red'}
        />
        <StatCard
          title="Занятий проведено"
          value={completed.length}
          icon={<CheckCircle2 size={20} />}
          color="blue"
          subtitle={`${upcoming.length} впереди`}
        />
        <StatCard
          title="ДЗ выдано"
          value={homeworks.length}
          icon={<ClipboardList size={20} />}
          color="purple"
        />
      </div>

      {/* Teacher / Curator */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PersonCard
          role="Преподаватель"
          icon={<GraduationCap size={16} />}
          profile={group.teacher?.profile}
          link={group.teacher ? `/teachers/${group.teacher.id}` : null}
        />
        <PersonCard
          role="Куратор"
          icon={<UserCheck size={16} />}
          profile={group.curator?.profile}
          link={null}
        />
      </div>

      {/* Students */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users size={17} />Ученики ({students.length})</CardTitle>
        </CardHeader>
        {students.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">В группе пока нет учеников</p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="text-left font-medium py-2 px-5">Ученик</th>
                  <th className="text-center font-medium py-2 px-3 hidden sm:table-cell">Класс</th>
                  <th className="text-center font-medium py-2 px-3">XP</th>
                  <th className="text-center font-medium py-2 px-3">Посещ.</th>
                  <th className="text-center font-medium py-2 px-3">ДЗ</th>
                  <th className="w-8 px-5" />
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/students/${s.id}`)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold overflow-hidden shrink-0">
                          {s.avatar_url
                            ? <img src={s.avatar_url} className="w-full h-full object-cover" alt="" />
                            : s.full_name.charAt(0).toUpperCase()
                          }
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">{s.full_name}</div>
                          <div className="text-xs text-gray-400 truncate">{s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center text-gray-600 hidden sm:table-cell">{s.grade || '—'}</td>
                    <td className="text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700">
                        <Trophy size={12} className="text-amber-500" />{s.xp_points}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className={cn('text-xs font-semibold',
                        s.att_rate >= 80 ? 'text-green-600' : s.att_rate >= 60 ? 'text-orange-500' : 'text-red-500')}>
                        {s.att_rate}%
                      </span>
                    </td>
                    <td className="text-center text-xs text-gray-600">
                      {s.hw_done}<span className="text-gray-300">/{s.hw_total}</span>
                    </td>
                    <td className="text-right pr-5"><ChevronRight size={14} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lessons + Homeworks grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Lessons */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Video size={17} />Занятия</CardTitle>
            <button onClick={() => navigate('/lessons')} className="text-xs text-primary-600 hover:text-primary-700">
              Все →
            </button>
          </CardHeader>
          {lessons.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">Занятий ещё нет</p>
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
                    <div className={cn('w-2 h-2 rounded-full shrink-0',
                      past ? 'bg-gray-300' : 'bg-blue-500')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{l.title}</div>
                      <div className="text-xs text-gray-400">{formatDateTime(l.scheduled_at)}</div>
                    </div>
                    {l.status === 'completed' ? (
                      <Badge variant="success" className="text-xs shrink-0">Завершено</Badge>
                    ) : l.status === 'cancelled' ? (
                      <Badge variant="default" className="text-xs shrink-0">Отменено</Badge>
                    ) : !past && l.zoom_link ? (
                      <a href={l.zoom_link} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700 shrink-0">
                        Zoom →
                      </a>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        {/* Homeworks */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ClipboardList size={17} />Домашние задания</CardTitle>
            <button onClick={() => navigate('/homeworks')} className="text-xs text-primary-600 hover:text-primary-700">
              Все →
            </button>
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
                        <div className={cn('text-xs mt-0.5', overdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                          {overdue ? '🔴 Истёк ' : 'до '}{formatDate(hw.due_date)}
                        </div>
                      </div>
                      <div className="text-xs text-right shrink-0">
                        <span className="font-semibold text-gray-900">{hw.submitted}</span>
                        <span className="text-gray-400">/{hw.total}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all',
                          pct === 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : 'bg-orange-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Course strip */}
      {group.course && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen size={17} />Курс</CardTitle>
          </CardHeader>
          <Link
            to="/course-program"
            className="flex items-center justify-between p-3 -mx-2 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <div>
              <div className="font-medium text-gray-900">{group.course.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {group.course.subject === 'physics' ? 'Физика' : group.course.subject === 'math' ? 'Математика' : group.course.subject}
                {group.course.exam_type && ` · ${group.course.exam_type.toUpperCase()}`}
                {group.course.start_date && group.course.end_date && (
                  <> · {formatDate(group.course.start_date)} → {formatDate(group.course.end_date)}</>
                )}
              </div>
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </Link>
        </Card>
      )}
    </div>
  )
}

// ── Person card (teacher / curator) ─────────────────────────────────────────
function PersonCard({
  role, icon, profile, link,
}: {
  role: string
  icon: React.ReactNode
  profile?: { id: string; full_name: string; email: string; phone: string | null; avatar_url: string | null }
  link: string | null
}) {
  if (!profile) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          {icon}<span>{role}: не назначен</span>
        </div>
      </Card>
    )
  }

  const inner = (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center text-base font-bold overflow-hidden shrink-0">
        {profile.avatar_url
          ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
          : profile.full_name.charAt(0).toUpperCase()
        }
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-gray-500 font-medium uppercase tracking-wide flex items-center gap-1">
          {icon}{role}
        </div>
        <div className="font-semibold text-gray-900 truncate group-hover:text-primary-700 transition-colors">{profile.full_name}</div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          {profile.email && (
            <a
              href={`mailto:${profile.email}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:text-gray-700 truncate"
            >
              <Mail size={11} />{profile.email}
            </a>
          )}
          {profile.phone && (
            <a
              href={`tel:${profile.phone}`}
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 hover:text-gray-700 shrink-0"
            >
              <Phone size={11} />{profile.phone}
            </a>
          )}
        </div>
      </div>
      {link && <ChevronRight size={16} className="text-gray-300 shrink-0 group-hover:text-primary-500 transition-colors" />}
    </div>
  )

  if (link) {
    return (
      <Link to={link} className="block">
        <Card className="group hover:border-primary-200 hover:shadow-sm transition-all cursor-pointer">
          {inner}
        </Card>
      </Link>
    )
  }
  return <Card>{inner}</Card>
}
