import { useState, useEffect } from 'react'
import { X, Calendar, Clock, Video, BookOpen, Loader2, GraduationCap, Users, User } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'

type LessonFormat = 'group' | 'individual'

const schema = z.object({
  title:            z.string().min(3, 'Минимум 3 символа'),
  group_id:         z.string().optional(),
  student_id:       z.string().optional(),
  scheduled_at:     z.string().min(1, 'Укажите дату и время'),
  duration_minutes: z.coerce.number().min(30, 'Минимум 30 мин').max(300),
  teacher_id:       z.string().optional(),
  zoom_link:        z.string().url('Укажите корректную ссылку').or(z.literal('')).optional(),
})

type FormValues = z.infer<typeof schema>

interface StudentOption { id: string; full_name: string; avatar_url: string | null }

interface TopicOption {
  id: string
  title: string
  moduleTitle: string
  moduleId: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  defaultDate?: Date | null
}

export function CreateLessonModal({ open, onClose, onCreated, defaultDate }: Props) {
  const profile = useAuthStore(s => s.profile)

  const [format,      setFormat]      = useState<LessonFormat>('group')
  const [groups,      setGroups]      = useState<{ id: string; name: string; course_id: string | null }[]>([])
  const [teachers,    setTeachers]    = useState<{ id: string; full_name: string }[]>([])
  const [students,    setStudents]    = useState<StudentOption[]>([])
  const [myTeacherId, setMyTeacherId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(false)

  // Topics for selected group's course
  const [topics,        setTopics]        = useState<TopicOption[]>([])
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { duration_minutes: 90, group_id: '', student_id: '', teacher_id: '' },
  })

  const watchedGroupId = watch('group_id')
  const durationVal    = watch('duration_minutes')

  // ── Load groups, teachers, students on open ──────────────────────────────────
  useEffect(() => {
    if (!open || !profile) return
    setLoadingData(true)
    setTopics([])
    setSelectedTopic('')
    setFormat('group')

    async function load() {
      try {
        // Always load students (needed for individual format)
        const { data: studs } = await supabase
          .from('profiles').select('id, full_name, avatar_url').eq('role', 'student').order('full_name')
        setStudents((studs || []) as StudentOption[])

        if (profile!.role === 'teacher') {
          const { data: teacher } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (teacher) {
            setMyTeacherId(teacher.id)
            const { data: grps } = await supabase
              .from('groups').select('id, name, course_id').eq('teacher_id', teacher.id).order('name')
            setGroups(grps || [])
          }
        } else {
          const [grpsRes, teachRes] = await Promise.all([
            supabase.from('groups').select('id, name, course_id').order('name'),
            supabase.from('teachers').select('id, profiles(full_name)').order('id'),
          ])
          setGroups(grpsRes.data || [])
          setTeachers((teachRes.data || []).map((t: any) => ({
            id: t.id,
            full_name: t.profiles?.full_name || '—',
          })))
        }
      } finally {
        setLoadingData(false)
      }
    }
    load()
  }, [open, profile])

  // ── Pre-fill date ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const base = defaultDate || new Date()
    const y = base.getFullYear()
    const m = String(base.getMonth() + 1).padStart(2, '0')
    const d = String(base.getDate()).padStart(2, '0')
    setValue('scheduled_at', `${y}-${m}-${d}T18:00`)
  }, [open, defaultDate, setValue])

  // ── Load topics when group changes ──────────────────────────────────────────
  useEffect(() => {
    if (!watchedGroupId) { setTopics([]); setSelectedTopic(''); return }

    const group = groups.find(g => g.id === watchedGroupId)
    if (!group?.course_id) { setTopics([]); setSelectedTopic(''); return }

    setLoadingTopics(true)
    setSelectedTopic('')

    async function loadTopics() {
      try {
        const { data: mods } = await supabase
          .from('modules')
          .select('id, title, order_index')
          .eq('course_id', group!.course_id)
          .order('order_index')

        if (!mods?.length) { setTopics([]); return }

        const { data: tops } = await supabase
          .from('topics')
          .select('id, title, module_id, order_index')
          .in('module_id', mods.map(m => m.id))
          .order('order_index')

        const options: TopicOption[] = (tops || []).map(t => {
          const mod = mods.find(m => m.id === t.module_id)
          return {
            id:          t.id,
            title:       t.title,
            moduleId:    t.module_id,
            moduleTitle: mod?.title || '',
          }
        })
        setTopics(options)
      } finally {
        setLoadingTopics(false)
      }
    }
    loadTopics()
  }, [watchedGroupId, groups])

  // ── When topic selected — auto-fill title ────────────────────────────────────
  function handleTopicChange(topicId: string) {
    setSelectedTopic(topicId)
    if (!topicId) return
    const t = topics.find(t => t.id === topicId)
    if (t) setValue('title', t.title, { shouldValidate: true })
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function onSubmit(values: FormValues) {
    const teacherId = myTeacherId ?? values.teacher_id
    if (!teacherId) { setError('Не удалось определить преподавателя.'); return }

    if (format === 'group' && !values.group_id) { setError('Выберите группу.'); return }
    if (format === 'individual' && !values.student_id) { setError('Выберите ученика.'); return }

    setSaving(true)
    setError(null)

    const { error: err } = await supabase.from('lessons').insert({
      title:            values.title,
      format,
      group_id:         format === 'group' ? (values.group_id || null) : null,
      student_id:       format === 'individual' ? (values.student_id || null) : null,
      teacher_id:       teacherId,
      topic_id:         format === 'group' ? (selectedTopic || null) : null,
      scheduled_at:     new Date(values.scheduled_at).toISOString(),
      duration_minutes: values.duration_minutes,
      status:           'scheduled',
      zoom_link:        values.zoom_link || null,
    })

    setSaving(false)
    if (err) { setError(err.message); return }

    reset({ duration_minutes: 90, group_id: '', student_id: '', teacher_id: '' })
    setSelectedTopic('')
    setTopics([])
    onCreated()
    onClose()
  }

  function handleClose() {
    reset({ duration_minutes: 90, group_id: '', student_id: '', teacher_id: '' })
    setSelectedTopic('')
    setTopics([])
    setError(null)
    onClose()
  }

  if (!open) return null

  // Build optgroups: module → topics
  const moduleGroups = Array.from(
    topics.reduce((acc, t) => {
      if (!acc.has(t.moduleId)) acc.set(t.moduleId, { title: t.moduleTitle, topics: [] })
      acc.get(t.moduleId)!.topics.push(t)
      return acc
    }, new Map<string, { title: string; topics: TopicOption[] }>())
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={handleClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center">
                <Calendar size={16} className="text-primary-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Новое занятие</h2>
                <p className="text-xs text-gray-400">
                  {format === 'individual' ? 'Индивидуальное занятие' : 'Групповое занятие'}
                </p>
              </div>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-5">

            {/* Format toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Формат занятия</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setFormat('group'); setValue('student_id', '') }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all',
                    format === 'group'
                      ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                      : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                  )}
                >
                  <Users size={15} />Групповое
                </button>
                <button
                  type="button"
                  onClick={() => { setFormat('individual'); setValue('group_id', ''); setTopics([]); setSelectedTopic('') }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all',
                    format === 'individual'
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : 'border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600'
                  )}
                >
                  <User size={15} />Индивидуальное
                </button>
              </div>
            </div>

            {/* Group OR Student selector */}
            {format === 'group' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Группа</label>
                {loadingData ? (
                  <div className="flex items-center gap-2 py-2 px-3 border border-gray-200 rounded-lg text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />Загрузка групп…
                  </div>
                ) : (
                  <select
                    className={cn(
                      'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500 border-gray-200'
                    )}
                    {...register('group_id')}
                  >
                    <option value="">— Выберите группу —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Ученик</label>
                {loadingData ? (
                  <div className="flex items-center gap-2 py-2 px-3 border border-gray-200 rounded-lg text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />Загрузка учеников…
                  </div>
                ) : (
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    {...register('student_id')}
                  >
                    <option value="">— Выберите ученика —</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Topic selector — shows after group chosen (group format only) */}
            {format === 'group' && watchedGroupId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <GraduationCap size={14} className="text-gray-400" />
                  Тема из программы курса
                  <span className="text-gray-400 font-normal">(необязательно)</span>
                </label>

                {loadingTopics ? (
                  <div className="flex items-center gap-2 py-2 px-3 border border-gray-200 rounded-lg text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />Загрузка тем…
                  </div>
                ) : topics.length === 0 ? (
                  <div className="py-2 px-3 border border-gray-100 rounded-lg text-sm text-gray-400 bg-gray-50">
                    У курса этой группы нет тем
                  </div>
                ) : (
                  <select
                    value={selectedTopic}
                    onChange={e => handleTopicChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">— Без привязки к теме —</option>
                    {moduleGroups.map(([modId, mod]) => (
                      <optgroup key={modId} label={`📦 ${mod.title}`}>
                        {mod.topics.map(t => (
                          <option key={t.id} value={t.id}>{t.title}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}

                {selectedTopic && (
                  <p className="mt-1 text-xs text-primary-600 flex items-center gap-1">
                    ✓ Название занятия заполнено из темы — можно изменить ниже
                  </p>
                )}
              </div>
            )}

            {/* Title */}
            <Input
              label="Название занятия"
              placeholder="Например: Механика — законы Ньютона"
              icon={<BookOpen size={15} />}
              error={errors.title?.message}
              {...register('title')}
            />

            {/* Teacher — admin only */}
            {profile?.role !== 'teacher' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Преподаватель</label>
                {loadingData ? (
                  <div className="flex items-center gap-2 py-2 px-3 border border-gray-200 rounded-lg text-sm text-gray-400">
                    <Loader2 size={14} className="animate-spin" />Загрузка…
                  </div>
                ) : (
                  <select
                    className={cn(
                      'w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900',
                      'focus:outline-none focus:ring-2 focus:ring-primary-500',
                      errors.teacher_id ? 'border-red-400' : 'border-gray-200'
                    )}
                    {...register('teacher_id')}
                  >
                    <option value="">— Выберите преподавателя —</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </select>
                )}
              </div>
            )}

            {profile?.role === 'teacher' && myTeacherId && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-700">
                <span className="font-medium">Преподаватель:</span> {profile.full_name}
              </div>
            )}

            {/* Date & time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Дата и время</label>
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="datetime-local"
                  className={cn(
                    'w-full rounded-lg border bg-white pl-10 pr-3 py-2 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-primary-500',
                    errors.scheduled_at ? 'border-red-400' : 'border-gray-200'
                  )}
                  {...register('scheduled_at')}
                />
              </div>
              {errors.scheduled_at && <p className="mt-1 text-xs text-red-600">{errors.scheduled_at.message}</p>}
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Длительность (мин.)</label>
              <div className="flex gap-2">
                {[60, 90, 120].map(d => (
                  <button
                    key={d} type="button"
                    onClick={() => setValue('duration_minutes', d, { shouldValidate: true })}
                    className={cn(
                      'flex-1 py-2 rounded-lg border text-sm font-medium transition-all',
                      Number(durationVal) === d
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                    )}
                  >
                    {d} мин.
                  </button>
                ))}
                <div className="relative flex-1">
                  <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="number" min={30} max={300} placeholder="Своё"
                    className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    {...register('duration_minutes')}
                  />
                </div>
              </div>
              {errors.duration_minutes && <p className="mt-1 text-xs text-red-600">{errors.duration_minutes.message}</p>}
            </div>

            {/* Zoom */}
            <Input
              label="Ссылка Zoom / Meet (необязательно)"
              placeholder="https://zoom.us/j/..."
              icon={<Video size={15} />}
              error={errors.zoom_link?.message}
              {...register('zoom_link')}
            />

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="secondary" className="flex-1" onClick={handleClose}>
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={saving || loadingData}>
                {saving ? <><Loader2 size={15} className="animate-spin mr-1" />Сохраняем…</> : 'Создать занятие'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
