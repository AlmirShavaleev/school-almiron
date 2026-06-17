import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ClipboardList, Calendar, Users, FileText, ExternalLink,
  CheckCircle2, Clock, AlertCircle, Loader2, Download, Star,
  GraduationCap, BookOpen, ChevronRight, Trophy, RotateCcw, MessageSquare,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ReviewHomeworkModal } from '@/components/modals/ReviewHomeworkModal'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDate } from '@/utils/format'

interface HomeworkFull {
  id:          string
  title:       string
  description: string | null
  due_date:    string
  max_score:   number
  file_url:    string | null
  created_at:  string
  group:   { id: string; name: string; course_title: string | null } | null
  lesson:  { id: string; title: string; scheduled_at: string } | null
  topic:   { id: string; title: string; module_title: string | null } | null
  teacher: { id: string; full_name: string; avatar_url: string | null } | null
}

interface SubmissionRow {
  id:           string
  student_id:   string
  status:       string
  score:        number | null
  feedback:     string | null
  submitted_at: string | null
  file_url:     string | null
  answer_text:  string | null
  full_name:    string
  avatar_url:   string | null
}

const STATUS_META: Record<string, { label: string; cls: string; dotCls: string }> = {
  not_submitted: { label: 'Не сдано',    cls: 'text-gray-600 bg-gray-100',     dotCls: 'bg-gray-300' },
  submitted:     { label: 'На проверке', cls: 'text-orange-700 bg-orange-50',  dotCls: 'bg-orange-400' },
  checked:       { label: 'Проверено',   cls: 'text-green-700 bg-green-50',    dotCls: 'bg-green-500' },
  revision:      { label: 'На доработке', cls: 'text-blue-700 bg-blue-50',     dotCls: 'bg-blue-500' },
}

type TabKey = 'all' | 'submitted' | 'checked' | 'not_submitted'

export function HomeworkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile  = useAuthStore(s => s.profile)
  const canReview = profile && ['teacher', 'admin', 'owner'].includes(profile.role)

  const [hw,            setHW]            = useState<HomeworkFull | null>(null)
  const [submissions,   setSubmissions]   = useState<SubmissionRow[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [tab,           setTab]           = useState<TabKey>('all')
  const [reviewOpen,    setReviewOpen]    = useState(false)
  const [tick,          setTick]          = useState(0)
  const reload = () => setTick(t => t + 1)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)

    load()
      .catch(e => { if (!cancelled) setError(e.message || 'Ошибка загрузки') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }

    async function load() {
      // Round 1: homework + group students
      const { data: hwData, error: hwErr } = await supabase
        .from('homeworks')
        .select(`
          id, title, description, due_date, max_score, file_url, created_at, group_id, created_by,
          groups(id, name, courses(title)),
          lessons(id, title, scheduled_at),
          topics(id, title, modules(title)),
          teachers(id, profiles(full_name, avatar_url))
        `)
        .eq('id', id!)
        .single()

      if (hwErr) throw hwErr
      if (cancelled) return

      const h: any = hwData
      const built: HomeworkFull = {
        id: h.id, title: h.title, description: h.description,
        due_date: h.due_date, max_score: h.max_score, file_url: h.file_url,
        created_at: h.created_at,
        group: h.groups ? { id: h.groups.id, name: h.groups.name, course_title: h.groups.courses?.title || null } : null,
        lesson: h.lessons ? { id: h.lessons.id, title: h.lessons.title, scheduled_at: h.lessons.scheduled_at } : null,
        topic: h.topics ? { id: h.topics.id, title: h.topics.title, module_title: h.topics.modules?.title || null } : null,
        teacher: h.teachers ? { id: h.teachers.id, full_name: h.teachers.profiles?.full_name || '—', avatar_url: h.teachers.profiles?.avatar_url || null } : null,
      }

      // Round 2: group students + existing submissions
      const [gsRes, subRes] = await Promise.all([
        h.group_id
          ? supabase.from('group_students')
              .select('students(id, profile_id, profiles(full_name, avatar_url))')
              .eq('group_id', h.group_id)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('homework_submissions')
          .select('id, student_id, status, score, feedback, submitted_at, file_url, answer_text')
          .eq('homework_id', id!),
      ])
      if (cancelled) return

      const rawStudents: any[] = (gsRes.data || []).map((r: any) => r.students).filter(Boolean)
      const subMap = new Map<string, any>()
      for (const s of subRes.data || []) subMap.set((s as any).student_id, s)

      // Build full list (one row per student — submitted or not)
      const rows: SubmissionRow[] = rawStudents.map(st => {
        const s = subMap.get(st.id)
        return {
          id:           s?.id || '',
          student_id:   st.id,
          status:       s?.status || 'not_submitted',
          score:        s?.score ?? null,
          feedback:     s?.feedback ?? null,
          submitted_at: s?.submitted_at ?? null,
          file_url:     s?.file_url ?? null,
          answer_text:  s?.answer_text ?? null,
          full_name:    st.profiles?.full_name || '—',
          avatar_url:   st.profiles?.avatar_url || null,
        }
      }).sort((a, b) => {
        // Order: submitted → not_submitted → checked
        const order: Record<string, number> = { submitted: 0, revision: 1, not_submitted: 2, checked: 3 }
        const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9)
        return diff !== 0 ? diff : a.full_name.localeCompare(b.full_name)
      })

      setHW(built)
      setSubmissions(rows)
    }
  }, [id, tick])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-600" />
        <span className="text-gray-500 text-sm">Загружаем домашнее задание…</span>
      </div>
    )
  }

  if (error || !hw) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-red-400" />
        <p className="text-gray-700">{error || 'ДЗ не найдено'}</p>
        <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline">Назад</button>
      </div>
    )
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const now = new Date()
  const dueDate = new Date(hw.due_date)
  const isOverdue = dueDate < now
  const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / 86400_000)

  const total           = submissions.length
  const submittedCount  = submissions.filter(s => s.status === 'submitted').length
  const checkedCount    = submissions.filter(s => s.status === 'checked').length
  const revisionCount   = submissions.filter(s => s.status === 'revision').length
  const notSubmitted    = submissions.filter(s => s.status === 'not_submitted').length
  const sentRate        = total > 0 ? Math.round((submittedCount + checkedCount + revisionCount) / total * 100) : 0
  const avgScore        = (() => {
    const scored = submissions.filter(s => s.score != null)
    if (scored.length === 0) return null
    return Math.round(scored.reduce((sum, s) => sum + (s.score || 0), 0) / scored.length * 10) / 10
  })()

  // Filtered rows
  const filtered = tab === 'all' ? submissions : submissions.filter(s => s.status === tab)

  return (
    <div className="space-y-5">

      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft size={15} />Назад
      </button>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl p-5 sm:p-6 text-white',
        isOverdue && submittedCount > 0
          ? 'bg-gradient-to-br from-red-500 to-orange-500'
          : isOverdue
          ? 'bg-gradient-to-br from-slate-600 to-slate-800'
          : 'bg-gradient-to-br from-orange-500 to-pink-500'
      )}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20">
                <ClipboardList size={12} />Домашнее задание
              </span>
              {isOverdue ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-white text-red-600">
                  <Clock size={12} />Дедлайн истёк
                </span>
              ) : daysLeft <= 1 ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-900">
                  ⚡ {daysLeft === 0 ? 'Сегодня' : 'Завтра'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-white/25">
                  через {daysLeft} дн.
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold leading-tight">{hw.title}</h1>

            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-white/90 mt-3">
              <div className="inline-flex items-center gap-1.5">
                <Calendar size={14} />до {formatDateTime(hw.due_date)}
              </div>
              <div className="inline-flex items-center gap-1.5">
                <Trophy size={14} />макс. {hw.max_score} баллов
              </div>
              {hw.group && (
                <Link to={`/groups/${hw.group.id}`} className="inline-flex items-center gap-1.5 hover:text-white underline-offset-2 hover:underline">
                  <Users size={14} />{hw.group.name}
                </Link>
              )}
            </div>

            {hw.topic && (
              <div className="text-xs text-white/80 mt-2">
                {hw.topic.module_title && <span className="opacity-70">{hw.topic.module_title} · </span>}
                {hw.topic.title}
              </div>
            )}
          </div>

          {/* Action button */}
          {canReview && submittedCount > 0 && (
            <button
              onClick={() => setReviewOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-900 rounded-xl font-semibold text-sm hover:bg-gray-100 transition-colors shadow-sm shrink-0"
            >
              <CheckCircle2 size={16} />Проверить ({submittedCount})
            </button>
          )}
        </div>
      </div>

      {/* ── Description & file ────────────────────────────────────────────── */}
      {(hw.description || hw.file_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText size={17} />Условие</CardTitle>
            {hw.file_url && (
              <a href={hw.file_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
                <Download size={13} />Скачать файл
              </a>
            )}
          </CardHeader>
          {hw.description ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{hw.description}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">Описание не указано</p>
          )}
        </Card>
      )}

      {/* ── 3 small cards: teacher + lesson + group ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {hw.teacher && (
          <Link to={`/teachers/${hw.teacher.id}`}
            className="group block bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all">
            <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <GraduationCap size={13} />Преподаватель
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center font-bold overflow-hidden shrink-0">
                {hw.teacher.avatar_url
                  ? <img src={hw.teacher.avatar_url} className="w-full h-full object-cover" alt="" />
                  : hw.teacher.full_name.charAt(0).toUpperCase()
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 truncate group-hover:text-primary-700">{hw.teacher.full_name}</div>
              </div>
              <ChevronRight size={14} className="text-gray-300 group-hover:text-primary-500" />
            </div>
          </Link>
        )}

        {hw.lesson && (
          <Link to={`/lessons/${hw.lesson.id}`}
            className="group block bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all">
            <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <BookOpen size={13} />Урок
            </div>
            <div className="font-semibold text-gray-900 truncate group-hover:text-primary-700">{hw.lesson.title}</div>
            <div className="text-xs text-gray-400 mt-1">{formatDateTime(hw.lesson.scheduled_at)}</div>
          </Link>
        )}

        {hw.group?.course_title && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <BookOpen size={13} />Курс
            </div>
            <div className="font-semibold text-gray-900 truncate">{hw.group.course_title}</div>
          </div>
        )}
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Сдали"        value={`${submittedCount + checkedCount + revisionCount}/${total}`} sub={`${sentRate}%`}    color="blue" />
        <StatBox label="На проверке"  value={submittedCount}   sub={submittedCount > 0 ? 'ждут оценки' : '—'} color={submittedCount > 0 ? 'orange' : 'gray'} />
        <StatBox label="Проверено"    value={checkedCount}     sub={revisionCount > 0 ? `+${revisionCount} на доработке` : '—'} color="green" />
        <StatBox label="Средний балл" value={avgScore != null ? `${avgScore}/${hw.max_score}` : '—'} sub={notSubmitted > 0 ? `${notSubmitted} не сдали` : 'все сдали'} color="purple" />
      </div>

      {/* ── Submissions tabs + table ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users size={17} />Сдачи ({total})</CardTitle>
        </CardHeader>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-2 mb-3 border-b border-gray-100 -mx-1 px-1">
          {([
            { key: 'all',           label: 'Все',         count: total },
            { key: 'submitted',     label: 'На проверке', count: submittedCount },
            { key: 'checked',       label: 'Проверено',   count: checkedCount },
            { key: 'not_submitted', label: 'Не сдали',    count: notSubmitted },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                tab === t.key ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {t.label}<span className="ml-1.5 text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Нет записей</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(row => {
              const meta = STATUS_META[row.status] || STATUS_META.not_submitted
              const scorePct = row.score != null && hw.max_score > 0
                ? Math.round(row.score / hw.max_score * 100) : null
              return (
                <div
                  key={row.student_id}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/students/${row.student_id}`)}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dotCls)} />
                  <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold overflow-hidden shrink-0">
                    {row.avatar_url
                      ? <img src={row.avatar_url} className="w-full h-full object-cover" alt="" />
                      : row.full_name.charAt(0).toUpperCase()
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{row.full_name}</div>
                    <div className="text-xs text-gray-400 truncate">
                      {row.submitted_at
                        ? `Сдал ${formatDateTime(row.submitted_at)}`
                        : 'Работа не отправлена'}
                      {row.feedback && <span className="text-blue-500 ml-2">· есть комментарий</span>}
                    </div>
                  </div>

                  {/* Score */}
                  {row.score != null && (
                    <div className="text-right shrink-0">
                      <div className={cn('font-bold text-sm',
                        (scorePct ?? 0) >= 80 ? 'text-green-600' :
                        (scorePct ?? 0) >= 60 ? 'text-orange-500' : 'text-red-500'
                      )}>
                        {row.score}<span className="text-gray-400 font-normal">/{hw.max_score}</span>
                      </div>
                      {scorePct != null && <div className="text-[10px] text-gray-400">{scorePct}%</div>}
                    </div>
                  )}

                  {/* Status badge */}
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-md shrink-0', meta.cls)}>
                    {meta.label}
                  </span>

                  {/* File link */}
                  {row.file_url && (
                    <a href={row.file_url} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-gray-400 hover:text-primary-600 shrink-0"
                      title="Скачать работу"
                    >
                      <Download size={14} />
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Review modal */}
      <ReviewHomeworkModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onReviewed={() => reload()}
        homework={{ id: hw.id, title: hw.title, max_score: hw.max_score }}
      />
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color }: { label: string; value: React.ReactNode; sub: string; color: 'blue'|'orange'|'green'|'purple'|'gray' }) {
  const colorMap = {
    blue:   'text-blue-700',
    orange: 'text-orange-600',
    green:  'text-green-600',
    purple: 'text-purple-700',
    gray:   'text-gray-600',
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-1">{label}</div>
      <div className={cn('text-2xl font-bold leading-tight', colorMap[color])}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5 truncate">{sub}</div>
    </div>
  )
}
