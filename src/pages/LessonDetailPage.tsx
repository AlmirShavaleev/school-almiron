import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Calendar, Clock, Video, FileText, BookOpen, Users,
  CheckCircle2, XCircle, Loader2, AlertCircle, ChevronRight,
  GraduationCap, ClipboardList, ExternalLink, Pencil, Save,
  PlayCircle, BookMarked, Lightbulb, ClipboardCheck, Check, User,
  UserCheck, UserX, Timer, ShieldCheck, Trash2, Ban,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { formatDateTime, formatDate } from '@/utils/format'
import { EditLessonModal } from '@/components/modals/EditLessonModal'

interface LessonFull {
  id:               string
  title:            string
  scheduled_at:     string
  duration_minutes: number | null
  status:           string
  format:           'group' | 'individual'
  zoom_link:        string | null
  recording_url:    string | null
  notes:            string | null
  created_at:       string
  teacher_id:       string | null   // teachers.id (raw FK for updates)
  group_id:         string | null
  group:   { id: string; name: string; course_title: string | null } | null
  student: { id: string; full_name: string; avatar_url: string | null } | null
  teacher: { id: string; profile_id: string; full_name: string; avatar_url: string | null } | null
  topic:   { id: string; title: string; module_title: string | null } | null
}

interface AttendanceRow {
  student_id: string
  status:     string
  note:       string | null
  full_name:  string
  avatar_url: string | null
}

interface GroupStudent {
  student_id: string
  full_name:  string
  avatar_url: string | null
}

interface LessonHomework {
  id:       string
  title:    string
  due_date: string
}

interface TopicMaterial {
  id:       string
  type:     string
  content:  string | null
  file_url: string | null
  link_url: string | null
}

const MATERIAL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  notes:    { label: 'Конспект',    icon: <BookMarked size={14} />,    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  theory:   { label: 'Теория',      icon: <BookOpen size={14} />,      color: 'bg-purple-50 text-purple-700 border-purple-200' },
  tasks:    { label: 'Задачи',      icon: <ClipboardList size={14} />, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  homework: { label: 'ДЗ-материал', icon: <Lightbulb size={14} />,    color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  solution: { label: 'Решение',     icon: <Check size={14} />,         color: 'bg-green-50 text-green-700 border-green-200' },
  video:    { label: 'Видео',       icon: <Video size={14} />,         color: 'bg-red-50 text-red-700 border-red-200' },
}

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  scheduled: { label: 'Запланировано', cls: 'bg-blue-100 text-blue-700',   icon: <Clock size={13} /> },
  completed: { label: 'Завершено',     cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={13} /> },
  cancelled: { label: 'Отменено',      cls: 'bg-gray-100 text-gray-500',   icon: <XCircle size={13} /> },
}

// Статусы посещаемости — порядок важен (отображается в кнопках)
const ATT_STATUSES = [
  { key: 'present', label: 'Был',      short: '✓',  cls: 'bg-green-100 text-green-700  border-green-300',  dotCls: 'bg-green-500',  icon: <UserCheck size={13} /> },
  { key: 'late',    label: 'Опоздал',  short: '⏰', cls: 'bg-orange-100 text-orange-700 border-orange-300', dotCls: 'bg-orange-400', icon: <Timer size={13} /> },
  { key: 'absent',  label: 'Пропуск',  short: '✗',  cls: 'bg-red-100 text-red-700      border-red-300',     dotCls: 'bg-red-500',    icon: <UserX size={13} /> },
  { key: 'excused', label: 'Уваж.',    short: 'У',  cls: 'bg-blue-100 text-blue-700    border-blue-300',    dotCls: 'bg-blue-500',   icon: <ShieldCheck size={13} /> },
] as const

const ATT_META = Object.fromEntries(ATT_STATUSES.map(s => [s.key, s]))

// ── Inline confirm modal ────────────────────────────────────────────────────
interface ConfirmModalProps {
  open:         boolean
  title:        string
  message:      string
  confirmLabel: string
  confirmCls?:  string
  onConfirm:    () => void
  onCancel:     () => void
}
function ConfirmModal({ open, title, message, confirmLabel, confirmCls, onConfirm, onCancel }: ConfirmModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-xl hover:border-gray-300 hover:text-gray-900 transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className={cn('px-4 py-2 text-sm font-semibold text-white rounded-xl transition-colors cursor-pointer', confirmCls || 'bg-primary-600 hover:bg-primary-700')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LessonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile  = useAuthStore(s => s.profile)
  const canEdit  = profile && ['teacher', 'admin', 'owner'].includes(profile.role)

  const [lesson,        setLesson]        = useState<LessonFull | null>(null)
  const [attendance,    setAttendance]    = useState<AttendanceRow[]>([])
  const [groupStudents, setGroupStudents] = useState<GroupStudent[]>([])
  const [savingAtt,     setSavingAtt]     = useState<Set<string>>(new Set())
  const [homeworks,     setHomeworks]     = useState<LessonHomework[]>([])
  const [materials,     setMaterials]     = useState<TopicMaterial[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [hwTick,        setHwTick]        = useState(0)

  const [completing,   setCompleting]   = useState(false)
  const [cancelling,   setCancelling]   = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [deleteCheck,  setDeleteCheck]  = useState<{ allowed: boolean; reason: string | null } | null>(null)
  const [editOpen,     setEditOpen]     = useState(false)

  // Modal state: holds a resolve callback that settles a Promise<boolean>
  const modalResolveRef = useRef<((ok: boolean) => void) | null>(null)
  const [modalCfg, setModalCfg] = useState<{
    title: string; message: string; confirmLabel: string; confirmCls?: string
  } | null>(null)

  function openConfirm(cfg: typeof modalCfg): Promise<boolean> {
    return new Promise(resolve => {
      modalResolveRef.current = resolve
      setModalCfg(cfg)
    })
  }
  function handleModalConfirm() { modalResolveRef.current?.(true);  setModalCfg(null) }
  function handleModalCancel()  { modalResolveRef.current?.(false); setModalCfg(null) }

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft,   setNotesDraft]   = useState('')
  const [savingNotes,  setSavingNotes]  = useState(false)

  // Reload only homeworks (after creating a new one)
  useEffect(() => {
    if (!id || hwTick === 0) return
    supabase.from('homeworks').select('id, title, due_date').eq('lesson_id', id)
      .then(({ data }) => setHomeworks(data || []))
  }, [id, hwTick])

  // Check if lesson is deletable (for admin/owner only)
  useEffect(() => {
    if (!lesson || !profile?.role || !['admin', 'owner'].includes(profile.role)) return
    supabase.rpc('fn_check_lesson_deletable', { p_lesson_id: lesson.id })
      .then(({ data }) => {
        if (data) setDeleteCheck(data as { allowed: boolean; reason: string | null })
      })
  }, [lesson?.id, lesson?.status, profile?.role])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)

    load()
      .catch(e => { if (!cancelled) setError(e.message || 'Ошибка загрузки') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }

    async function load() {
      // Round 1: lesson + attendance + homeworks (parallel)
      const [lRes, aRes, hRes] = await Promise.all([
        supabase.from('lessons')
          .select(`
            id, group_id, student_id, topic_id, teacher_id, title, scheduled_at, duration_minutes,
            status, format, zoom_link, recording_url, notes, created_at,
            groups(id, name, courses(title)),
            student:student_id(id, full_name, avatar_url),
            teachers(id, profile_id, profiles(full_name, avatar_url)),
            topics(id, title, modules(title))
          `)
          .eq('id', id!)
          .single(),

        supabase.from('attendance')
          .select('student_id, status, note, students(profiles(full_name, avatar_url))')
          .eq('lesson_id', id!),

        supabase.from('homeworks')
          .select('id, title, due_date')
          .eq('lesson_id', id!)
          .order('due_date', { ascending: true }),
      ])

      if (lRes.error) throw lRes.error
      if (cancelled) return

      const l: any = lRes.data
      const built: LessonFull = {
        id: l.id,
        title: l.title,
        scheduled_at: l.scheduled_at,
        duration_minutes: l.duration_minutes,
        status: l.status,
        format: l.format || 'group',
        zoom_link: l.zoom_link,
        recording_url: l.recording_url,
        notes: l.notes,
        created_at: l.created_at,
        teacher_id: l.teacher_id ?? null,
        group_id: l.group_id ?? null,
        group: l.groups ? {
          id: l.groups.id, name: l.groups.name,
          course_title: l.groups.courses?.title || null,
        } : null,
        student: l.student ? {
          id: l.student.id,
          full_name: l.student.full_name || '—',
          avatar_url: l.student.avatar_url || null,
        } : null,
        teacher: l.teachers ? {
          id: l.teachers.id,
          profile_id: l.teachers.profile_id,
          full_name: l.teachers.profiles?.full_name || '—',
          avatar_url: l.teachers.profiles?.avatar_url || null,
        } : null,
        topic: l.topics ? {
          id: l.topics.id, title: l.topics.title,
          module_title: l.topics.modules?.title || null,
        } : null,
      }

      // Round 2: topic materials + group students (parallel if needed)
      const round2: any[] = []

      if (built.topic) {
        round2.push(
          supabase.from('topic_materials')
            .select('id, type, content, file_url, link_url')
            .eq('topic_id', built.topic.id)
        )
      } else {
        round2.push(Promise.resolve({ data: [] }))
      }

      if (built.group && built.format !== 'individual') {
        round2.push(
          supabase.from('group_students')
            .select('student_id, students(profiles(full_name, avatar_url))')
            .eq('group_id', built.group.id)
        )
      } else {
        round2.push(Promise.resolve({ data: [] }))
      }

      const [matsRes, gsRes] = await Promise.all(round2)
      if (cancelled) return

      const mats: TopicMaterial[] = (matsRes.data || []).map((m: any) => ({
        id: m.id, type: m.type,
        content: m.content, file_url: m.file_url, link_url: m.link_url,
      }))

      const gs: GroupStudent[] = (gsRes.data || [])
        .map((g: any) => ({
          student_id: g.student_id,
          full_name:  g.students?.profiles?.full_name  || '—',
          avatar_url: g.students?.profiles?.avatar_url || null,
        }))
        .sort((a: GroupStudent, b: GroupStudent) => a.full_name.localeCompare(b.full_name))

      // Build attendance rows
      const attRows: AttendanceRow[] = (aRes.data || []).map((a: any) => ({
        student_id: a.student_id,
        status:     a.status,
        note:       a.note,
        full_name:  a.students?.profiles?.full_name  || '—',
        avatar_url: a.students?.profiles?.avatar_url || null,
      })).sort((a: AttendanceRow, b: AttendanceRow) => a.full_name.localeCompare(b.full_name))

      setLesson(built)
      setAttendance(attRows)
      setGroupStudents(gs)
      setHomeworks(hRes.data || [])
      setMaterials(mats)
      setNotesDraft(built.notes || '')
    }
  }, [id])

  async function handleSaveNotes() {
    if (!lesson) return
    setSavingNotes(true)
    const { error } = await supabase
      .from('lessons')
      .update({ notes: notesDraft.trim() || null })
      .eq('id', lesson.id)
    setSavingNotes(false)
    if (error) return
    setLesson({ ...lesson, notes: notesDraft.trim() || null })
    setEditingNotes(false)
  }

  async function markCompleted() {
    if (!lesson) return
    const ok = await openConfirm({
      title:        'Завершить занятие?',
      message:      'Статус изменится на «Завершено».\n\nВнимание: если для студентов группы настроены тарифы, будет автоматически списана оплата.',
      confirmLabel: 'Завершить',
      confirmCls:   'bg-green-600 hover:bg-green-700',
    })
    if (!ok) return
    setCompleting(true)
    const { error } = await supabase.from('lessons').update({ status: 'completed' }).eq('id', lesson.id)
    setCompleting(false)
    if (error) {
      toast.error('Ошибка: ' + error.message)
    } else {
      setLesson({ ...lesson, status: 'completed' })
      setDeleteCheck({ allowed: false, reason: 'Нельзя удалить завершённое занятие — история посещаемости и биллинга должна сохраняться.' })
      toast.success('Занятие отмечено завершённым')
    }
  }

  async function cancelLesson() {
    if (!lesson) return
    const ok = await openConfirm({
      title:        'Отменить занятие?',
      message:      'Статус изменится на «Отменено». Посещаемость и данные занятия сохранятся.',
      confirmLabel: 'Отменить',
      confirmCls:   'bg-gray-700 hover:bg-gray-800',
    })
    if (!ok) return
    setCancelling(true)
    const { error } = await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lesson.id)
    setCancelling(false)
    if (error) {
      toast.error('Ошибка: ' + error.message)
    } else {
      setLesson({ ...lesson, status: 'cancelled' })
      setDeleteCheck({ allowed: false, reason: 'Нельзя удалить отменённое занятие — используйте архивирование.' })
      toast.success('Занятие отменено')
    }
  }

  async function deleteLesson() {
    if (!lesson) return
    // Block if server check says no
    if (deleteCheck?.allowed === false) {
      toast.error(deleteCheck.reason || 'Удаление запрещено')
      return
    }
    const ok = await openConfirm({
      title:        `Удалить «${lesson.title}»?`,
      message:      'Занятие будет удалено безвозвратно.\n\nДомашние задания и транзакции отвяжутся (не удалятся).',
      confirmLabel: 'Удалить',
      confirmCls:   'bg-red-600 hover:bg-red-700',
    })
    if (!ok) return
    setDeleting(true)
    const { error } = await supabase.rpc('fn_safe_delete_lesson', { p_lesson_id: lesson.id })
    setDeleting(false)
    if (error) {
      // Strip SQL EXCEPTION prefix (e.g. "not_allowed: ...")
      const msg = error.message.replace(/^[A-Z0-9_]+:\s*/i, '')
      toast.error(msg || 'Ошибка удаления')
    } else {
      toast.success('Занятие удалено')
      navigate('/lessons')
    }
  }

  // Inline attendance: auto-save on click
  const handleAttChange = useCallback(async (studentId: string, newStatus: string) => {
    if (!id) return
    // Prevent double-save for this student
    if (savingAtt.has(studentId)) return

    // Remember previous status for rollback
    let prevStatus: string | null = null
    setAttendance(prev => {
      const existing = prev.find(a => a.student_id === studentId)
      prevStatus = existing?.status ?? null
      if (existing) {
        return prev.map(a => a.student_id === studentId ? { ...a, status: newStatus } : a)
      }
      const gs = groupStudents.find(s => s.student_id === studentId)
      return [...prev, {
        student_id: studentId,
        status:     newStatus,
        note:       null,
        full_name:  gs?.full_name  || '—',
        avatar_url: gs?.avatar_url || null,
      }]
    })

    setSavingAtt(prev => new Set(prev).add(studentId))
    const { error } = await supabase
      .from('attendance')
      .upsert(
        { lesson_id: id, student_id: studentId, status: newStatus } as any,
        { onConflict: 'lesson_id,student_id' }
      )
    setSavingAtt(prev => { const s = new Set(prev); s.delete(studentId); return s })

    if (error) {
      toast.error('Ошибка сохранения посещаемости')
      // Rollback optimistic update
      if (prevStatus === null) {
        setAttendance(prev => prev.filter(a => a.student_id !== studentId))
      } else {
        setAttendance(prev => prev.map(a =>
          a.student_id === studentId ? { ...a, status: prevStatus! } : a
        ))
      }
    }
  }, [id, groupStudents, savingAtt])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin text-primary-600" />
        <span className="text-gray-500 text-sm">Загружаем урок…</span>
      </div>
    )
  }

  if (error || !lesson) {
    return (
      <div className="max-w-md mx-auto mt-12 text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-red-400" />
        <p className="text-gray-700">{error || 'Урок не найден'}</p>
        <button onClick={() => navigate(-1)} className="text-primary-600 hover:underline">Назад</button>
      </div>
    )
  }

  // Computed
  const startedAt = new Date(lesson.scheduled_at)
  const endedAt   = new Date(startedAt.getTime() + (lesson.duration_minutes || 60) * 60_000)
  const now       = new Date()
  const isLive    = now >= startedAt && now <= endedAt && lesson.status !== 'cancelled'
  const isPast    = now > endedAt
  const isFuture  = now < startedAt

  const presentCount  = attendance.filter(a => a.status === 'present' || a.status === 'late').length
  const absentCount   = attendance.filter(a => a.status === 'absent').length
  const totalStudents = groupStudents.length > 0 ? groupStudents.length : attendance.length
  const markedCount   = attendance.length
  const attRate       = totalStudents > 0 ? Math.round(presentCount / totalStudents * 100) : 0
  const statusMeta    = STATUS_META[lesson.status] || STATUS_META.scheduled

  // Build merged display list for attendance: all group students + anyone in attendance not in group
  const attMap = new Map(attendance.map(a => [a.student_id, a]))
  const displayStudents: GroupStudent[] = groupStudents.length > 0
    ? groupStudents
    : attendance.map(a => ({ student_id: a.student_id, full_name: a.full_name, avatar_url: a.avatar_url }))

  return (
    <div className="space-y-5">

      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft size={15} />Назад
      </button>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl p-5 sm:p-6 text-white',
        isLive    ? 'bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shadow-red-200' :
        isPast    ? 'bg-gradient-to-br from-slate-600 to-slate-800' :
                    'bg-gradient-to-br from-primary-600 to-purple-600'
      )}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {isLive && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-full bg-white text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />ИДЁТ СЕЙЧАС
                </span>
              )}
              <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', statusMeta.cls)}>
                {statusMeta.icon}{statusMeta.label}
              </span>
              {lesson.format === 'individual' ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                  <User size={11} />Индивидуальное
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">
                  <Users size={11} />Групповое
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold leading-tight">{lesson.title}</h1>
            {lesson.topic && (
              <div className="text-sm text-white/90 mt-1">
                {lesson.topic.module_title && <span className="opacity-70">{lesson.topic.module_title} · </span>}
                {lesson.topic.title}
              </div>
            )}
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm text-white/90 mt-3">
              <div className="inline-flex items-center gap-1.5"><Calendar size={14} />{formatDateTime(lesson.scheduled_at)}</div>
              {lesson.duration_minutes && (
                <div className="inline-flex items-center gap-1.5"><Clock size={14} />{lesson.duration_minutes} мин</div>
              )}
              {lesson.format === 'individual' && lesson.student ? (
                <Link to={`/students/${lesson.student.id}`} className="inline-flex items-center gap-1.5 hover:text-white underline-offset-2 hover:underline">
                  <User size={14} />{lesson.student.full_name}
                </Link>
              ) : lesson.group ? (
                <Link to={`/groups/${lesson.group.id}`} className="inline-flex items-center gap-1.5 hover:text-white underline-offset-2 hover:underline">
                  <Users size={14} />{lesson.group.name}
                </Link>
              ) : null}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {/* Edit — admin/owner always; teacher only for own lesson */}
            {lesson.status === 'scheduled' && (() => {
              const isAdminOwner = profile?.role && ['admin', 'owner'].includes(profile.role)
              const isOwnLesson  = profile?.role === 'teacher' && lesson.teacher?.profile_id === profile.id
              return (isAdminOwner || isOwnLesson) ? (
                <button
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white rounded-xl font-medium text-sm transition-colors border border-white/20 cursor-pointer"
                >
                  <Pencil size={15} />Редактировать
                </button>
              ) : null
            })()}
            {lesson.zoom_link && (isLive || isFuture) && (
              <a href={lesson.zoom_link} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-900 rounded-xl font-semibold text-sm hover:bg-gray-100 transition-colors shadow-sm">
                <Video size={16} />{isLive ? 'Войти в Zoom' : 'Открыть Zoom'}
              </a>
            )}
            {lesson.recording_url && isPast && (
              <a href={lesson.recording_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/15 backdrop-blur text-white rounded-xl font-medium text-sm hover:bg-white/25 transition-colors border border-white/20">
                <PlayCircle size={16} />Запись урока
              </a>
            )}
            {canEdit && lesson.status === 'scheduled' && (
              <button
                onClick={markCompleted}
                disabled={completing}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl font-semibold text-sm transition-colors shadow-sm cursor-pointer"
              >
                {completing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Завершить
              </button>
            )}
            {canEdit && lesson.status === 'scheduled' && (
              <button
                onClick={cancelLesson}
                disabled={cancelling}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white rounded-xl font-medium text-sm transition-colors border border-white/20 cursor-pointer"
              >
                {cancelling ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                Отменить
              </button>
            )}
            {profile?.role && ['admin', 'owner'].includes(profile.role) && (
              <button
                onClick={deleteLesson}
                disabled={deleting || deleteCheck?.allowed === false}
                title={deleteCheck?.allowed === false ? (deleteCheck.reason ?? undefined) : undefined}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2.5 text-white rounded-xl font-medium text-sm transition-colors',
                  deleteCheck?.allowed === false
                    ? 'bg-gray-400 cursor-not-allowed opacity-60'
                    : 'bg-red-500/80 hover:bg-red-500 cursor-pointer'
                )}
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Удалить
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Top row: teacher card + stats ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Teacher */}
        {lesson.teacher && (
          <Link to={`/teachers/${lesson.teacher.id}`}
            className="group block bg-white rounded-2xl border border-gray-200 p-4 hover:border-primary-200 hover:shadow-sm transition-all">
            <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <GraduationCap size={13} />Преподаватель
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center font-bold overflow-hidden shrink-0">
                {lesson.teacher.avatar_url
                  ? <img src={lesson.teacher.avatar_url} className="w-full h-full object-cover" alt="" />
                  : lesson.teacher.full_name.charAt(0).toUpperCase()
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 truncate group-hover:text-primary-700">{lesson.teacher.full_name}</div>
              </div>
              <ChevronRight size={15} className="text-gray-300 group-hover:text-primary-500" />
            </div>
          </Link>
        )}

        {/* Course / Student card */}
        {lesson.format === 'individual' && lesson.student ? (
          <Link to={`/students/${lesson.student.id}`}
            className="group block bg-violet-50 rounded-2xl border border-violet-200 p-4 hover:border-violet-400 hover:shadow-sm transition-all">
            <div className="text-xs text-violet-600 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <User size={13} />Ученик
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-200 text-violet-700 flex items-center justify-center font-bold overflow-hidden shrink-0">
                {lesson.student.avatar_url
                  ? <img src={lesson.student.avatar_url} className="w-full h-full object-cover" alt="" />
                  : lesson.student.full_name.charAt(0).toUpperCase()
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 truncate group-hover:text-violet-700">{lesson.student.full_name}</div>
                <div className="text-xs text-violet-500">Индивидуальное занятие</div>
              </div>
              <ChevronRight size={15} className="text-violet-300 group-hover:text-violet-500" />
            </div>
          </Link>
        ) : lesson.group?.course_title ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
              <BookOpen size={13} />Курс
            </div>
            <div className="font-semibold text-gray-900 truncate">{lesson.group.course_title}</div>
            {lesson.group && (
              <Link to={`/groups/${lesson.group.id}`} className="text-xs text-primary-600 hover:text-primary-700 mt-1 inline-block">
                Группа {lesson.group.name} →
              </Link>
            )}
          </div>
        ) : null}

        {/* Attendance summary */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-2 flex items-center gap-1">
            <ClipboardCheck size={13} />Посещаемость
          </div>
          {markedCount === 0 && totalStudents === 0 ? (
            <div className="text-sm text-gray-400">Не отмечена</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <div className={cn('text-2xl font-bold',
                  attRate >= 80 ? 'text-green-600' : attRate >= 60 ? 'text-orange-500' : 'text-red-500')}>
                  {markedCount > 0 ? `${attRate}%` : '—'}
                </div>
                <div className="text-xs text-gray-500">
                  {markedCount}/{totalStudents} отмечено
                </div>
              </div>
              {markedCount > 0 && (
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1.5">
                  <span className="flex items-center gap-1 text-green-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />{presentCount} присут.
                  </span>
                  {absentCount > 0 && (
                    <span className="flex items-center gap-1 text-red-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />{absentCount} пропуск
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Notes + complete button (if can edit) ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText size={17} />Заметки урока</CardTitle>
          <div className="flex items-center gap-2">
            {canEdit && !editingNotes && (
              <button onClick={() => { setEditingNotes(true); setNotesDraft(lesson.notes || '') }}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Pencil size={12} />Редактировать
              </button>
            )}
          </div>
        </CardHeader>
        {editingNotes ? (
          <div className="space-y-3">
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              rows={5}
              placeholder="Что разобрали на уроке, важные тезисы, проблемные места…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSaveNotes} loading={savingNotes}>
                <Save size={13} className="mr-1" />Сохранить
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingNotes(false)}>Отмена</Button>
            </div>
          </div>
        ) : lesson.notes ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{lesson.notes}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">Заметки не добавлены</p>
        )}
      </Card>

      {/* ── 2-col: Attendance + Materials/HW ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Attendance card ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={17} />
              Посещаемость
              <span className="text-sm font-normal text-gray-400">
                ({markedCount}/{totalStudents})
              </span>
            </CardTitle>
            {/* Legend */}
            {canEdit && lesson.group && displayStudents.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {ATT_STATUSES.map(s => (
                  <span key={s.key} className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border', s.cls)}>
                    {s.icon}{s.label}
                  </span>
                ))}
              </div>
            )}
          </CardHeader>

          {displayStudents.length === 0 ? (
            /* No group students loaded — only happens for individual lessons */
            attendance.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <ClipboardCheck size={28} className="mx-auto mb-2 opacity-30" />
                Посещаемость пока не отмечена
              </div>
            ) : (
              /* Individual lesson — just show status */
              <div className="space-y-1.5">
                {attendance.map(a => {
                  const meta = ATT_META[a.status] || ATT_META.absent
                  return (
                    <div key={a.student_id} className="flex items-center gap-3 py-2 px-1 rounded-lg">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dotCls)} />
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 overflow-hidden shrink-0">
                        {a.avatar_url
                          ? <img src={a.avatar_url} className="w-full h-full object-cover" alt="" />
                          : a.full_name.charAt(0).toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 truncate">{a.full_name}</div>
                        {a.note && <div className="text-xs text-gray-400 truncate">{a.note}</div>}
                      </div>
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-md shrink-0', meta.cls)}>
                        {meta.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          ) : canEdit ? (
            /* ── INTERACTIVE attendance marking ── */
            <div className="space-y-1 max-h-[420px] overflow-y-auto -mx-1 px-1">
              {displayStudents.map(gs => {
                const attRow   = attMap.get(gs.student_id)
                const current  = attRow?.status || null
                const isSaving = savingAtt.has(gs.student_id)

                return (
                  <div key={gs.student_id}
                    className="flex items-center gap-2.5 py-2 px-2 rounded-xl hover:bg-gray-50 transition-colors">

                    {/* Avatar */}
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden shrink-0',
                      current ? ATT_META[current]?.cls.split(' ').slice(0,2).join(' ') : 'bg-gray-100 text-gray-500'
                    )}>
                      {gs.avatar_url
                        ? <img src={gs.avatar_url} className="w-full h-full object-cover" alt="" />
                        : gs.full_name.charAt(0).toUpperCase()
                      }
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{gs.full_name}</div>
                      {!current && (
                        <div className="text-[11px] text-gray-400">не отмечен</div>
                      )}
                    </div>

                    {/* Status buttons */}
                    {isSaving ? (
                      <Loader2 size={16} className="animate-spin text-gray-400 shrink-0 mr-1" />
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        {ATT_STATUSES.map(s => (
                          <button
                            key={s.key}
                            onClick={() => handleAttChange(gs.student_id, s.key)}
                            aria-label={s.label}
                            title={s.label}
                            className={cn(
                              'w-11 h-11 rounded-lg border text-xs font-bold flex items-center justify-center transition-all cursor-pointer',
                              current === s.key
                                ? cn(s.cls, 'shadow-sm scale-105')
                                : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 bg-white'
                            )}
                          >
                            {s.icon}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Quick actions */}
              {displayStudents.length > 1 && (
                <div className="pt-3 mt-2 border-t border-gray-100 flex gap-2 flex-wrap">
                  <button
                    onClick={() => displayStudents.forEach(gs => handleAttChange(gs.student_id, 'present'))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors"
                  >
                    <UserCheck size={12} />Все присутствовали
                  </button>
                  <button
                    onClick={() => displayStudents.forEach(gs => handleAttChange(gs.student_id, 'absent'))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
                  >
                    <UserX size={12} />Все пропустили
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ── READ-ONLY view (students / curators) ── */
            <div className="space-y-1.5 max-h-96 overflow-y-auto -mx-2 px-2">
              {displayStudents.map(gs => {
                const attRow = attMap.get(gs.student_id)
                const meta   = attRow ? (ATT_META[attRow.status] || ATT_META.absent) : null
                return (
                  <div key={gs.student_id} className="flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-gray-50">
                    {meta
                      ? <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dotCls)} />
                      : <span className="w-1.5 h-1.5 rounded-full bg-gray-200 shrink-0" />
                    }
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 overflow-hidden shrink-0">
                      {gs.avatar_url
                        ? <img src={gs.avatar_url} className="w-full h-full object-cover" alt="" />
                        : gs.full_name.charAt(0).toUpperCase()
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{gs.full_name}</div>
                      {attRow?.note && <div className="text-xs text-gray-400 truncate">{attRow.note}</div>}
                    </div>
                    {meta ? (
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-md shrink-0', meta.cls)}>
                        {meta.label}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300 shrink-0">—</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {/* Materials */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BookOpen size={17} />Материалы</CardTitle>
              {lesson.topic && (
                <span className="text-xs text-gray-400 truncate max-w-[60%]">{lesson.topic.title}</span>
              )}
            </CardHeader>
            {!lesson.topic ? (
              <p className="text-sm text-gray-400 py-4 text-center">Тема не привязана</p>
            ) : materials.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">Материалов нет</p>
            ) : (
              <div className="space-y-2">
                {materials.map(m => {
                  const meta = MATERIAL_META[m.type] || { label: m.type, icon: <FileText size={14} />, color: 'bg-gray-50 text-gray-700 border-gray-200' }
                  const href = m.link_url || m.file_url
                  const body = (
                    <div className={cn('flex items-center gap-3 p-3 rounded-xl border', meta.color)}>
                      <span className="shrink-0">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{meta.label}</div>
                        {m.content && <div className="text-xs opacity-75 truncate">{m.content}</div>}
                      </div>
                      {href && <ExternalLink size={13} className="opacity-60 shrink-0" />}
                    </div>
                  )
                  return href
                    ? <a key={m.id} href={href} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">{body}</a>
                    : <div key={m.id}>{body}</div>
                })}
              </div>
            )}
          </Card>

          {/* Homeworks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardList size={17} />Домашние задания</CardTitle>
              <div className="flex items-center gap-2">
                <Link to="/homeworks" className="text-xs text-primary-600 hover:text-primary-700">Все →</Link>
              </div>
            </CardHeader>
            {homeworks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">К уроку не привязано ДЗ</p>
            ) : (
              <div className="space-y-2">
                {homeworks.map(hw => {
                  const overdue = new Date(hw.due_date) < now
                  return (
                    <Link
                      key={hw.id}
                      to={`/homeworks/${hw.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-primary-200 hover:shadow-sm transition-all group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                        <ClipboardList size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate group-hover:text-primary-700">{hw.title}</div>
                        <div className={cn('text-xs', overdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                          {overdue ? '🔴 Истёк ' : 'до '}{formatDate(hw.due_date)}
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-primary-500 shrink-0" />
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={modalCfg !== null}
        title={modalCfg?.title ?? ''}
        message={modalCfg?.message ?? ''}
        confirmLabel={modalCfg?.confirmLabel ?? 'Подтвердить'}
        confirmCls={modalCfg?.confirmCls}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
      />

      {lesson.status === 'scheduled' && (
        <EditLessonModal
          open={editOpen}
          lesson={{
            id:               lesson.id,
            title:            lesson.title,
            scheduled_at:     lesson.scheduled_at,
            duration_minutes: lesson.duration_minutes,
            zoom_link:        lesson.zoom_link,
            notes:            lesson.notes,
            teacher_id:       lesson.teacher_id,
            group_id:         lesson.group_id,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={patch => {
            setLesson(prev => prev ? {
              ...prev,
              title:            patch.title,
              scheduled_at:     patch.scheduled_at,
              duration_minutes: patch.duration_minutes,
              zoom_link:        patch.zoom_link,
              notes:            patch.notes,
              teacher_id:       patch.teacher_id,
            } : prev)
            setEditOpen(false)
            toast.success('Занятие обновлено')
          }}
        />
      )}
    </div>
  )
}
