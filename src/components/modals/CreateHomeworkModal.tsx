import { useState, useEffect, useRef } from 'react'
import { X, ClipboardList, Loader2, Paperclip, FileText, XCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { notifyNewHomework } from '@/utils/notify'
import { formatDate } from '@/utils/format'

// ДЗ принадлежит ТЕМЕ курса (course-level), не группе.
const schema = z.object({
  title:       z.string().min(3, 'Минимум 3 символа'),
  description: z.string().optional(),
  due_date:    z.string().min(1, 'Укажите срок сдачи'),
  max_score:   z.coerce.number().min(1).max(100),
})
type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** Контекст группы — из него резолвится курс и преподаватель, тема выбирается из курса */
  defaultGroupId?: string
  /** Привязать к уроку */
  defaultLessonId?: string
  /** Предвыбрать тему (например со страницы темы) */
  defaultTopicId?: string
}

interface TopicOpt { id: string; label: string }

export function CreateHomeworkModal({ open, onClose, onCreated, defaultGroupId, defaultLessonId, defaultTopicId }: Props) {
  const profile = useAuthStore(s => s.profile)
  const [loadingData, setLoadingData] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // courses/topics context
  const [courses,  setCourses]  = useState<{ id: string; label: string }[]>([])
  const [courseId, setCourseId] = useState('')
  const [courseLocked, setCourseLocked] = useState(false)
  const [topics,   setTopics]   = useState<TopicOpt[]>([])
  const [topicId,  setTopicId]  = useState('')
  const [teacherId, setTeacherId] = useState<string | null>(null)

  const [file, setFile]         = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    mode: 'onChange',
    resolver: zodResolver(schema) as any,
    defaultValues: { max_score: 100 },
  })

  // ── load context ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !profile) return
    setLoadingData(true); setSubmitError(''); setFile(null)
    setTopicId(defaultTopicId || '')

    async function loadData() {
      try {
        // teacher → own id
        if (profile!.role === 'teacher') {
          const { data: tc } = await supabase.from('teachers').select('id').eq('profile_id', profile!.id).single()
          setTeacherId(tc?.id || null)
        } else setTeacherId(null)

        if (defaultGroupId) {
          // курс и учитель берутся из группы
          const { data: g } = await supabase.from('groups').select('course_id, teacher_id').eq('id', defaultGroupId).single()
          setCourseLocked(true)
          setCourseId(g?.course_id || '')
          if (profile!.role !== 'teacher') setTeacherId(g?.teacher_id || null)
          if (g?.course_id) await loadTopics(g.course_id)
        } else if (defaultTopicId) {
          // курс резолвится из темы (создание из Course Builder)
          const { data: t } = await supabase
            .from('topics').select('modules(course_id)').eq('id', defaultTopicId).single()
          const cid = (t as any)?.modules?.course_id || ''
          setCourseLocked(true)
          setCourseId(cid)
          if (cid) await loadTopics(cid)
        } else {
          // выбор курса (teacher → его курсы, иначе все)
          setCourseLocked(false)
          let cids: string[] | null = null
          if (profile!.role === 'teacher') {
            const { data: tc } = await supabase.from('teachers').select('id').eq('profile_id', profile!.id).single()
            const { data: gs } = await supabase.from('groups').select('course_id').eq('teacher_id', tc?.id || '')
            cids = [...new Set((gs || []).map((x: any) => x.course_id).filter(Boolean))]
          }
          let q = supabase.from('courses').select('id, title').order('title')
          if (cids) q = q.in('id', cids.length ? cids : ['00000000-0000-0000-0000-000000000000'])
          const { data: cs } = await q
          setCourses((cs || []).map((c: any) => ({ id: c.id, label: c.title })))
        }
      } finally {
        setLoadingData(false)
      }
    }
    loadData()
  }, [open, profile, defaultGroupId, defaultTopicId])

  async function loadTopics(cid: string) {
    const { data: mods } = await supabase
      .from('modules').select('order_index, title, topics(id, title, order_index)')
      .eq('course_id', cid).order('order_index')
    const opts: TopicOpt[] = []
    for (const m of (mods || []) as any[])
      for (const t of (m.topics || []).sort((a: any, b: any) => a.order_index - b.order_index))
        opts.push({ id: t.id, label: `${m.title} · ${t.title}` })
    setTopics(opts)
  }

  // when course changes (manual selection)
  useEffect(() => {
    if (!courseLocked && courseId) { setTopicId(''); loadTopics(courseId) }
  }, [courseId, courseLocked])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { setSubmitError('Файл слишком большой. Максимум 10 МБ.'); return }
    setFile(f); setSubmitError('')
  }
  function removeFile() { setFile(null); if (fileRef.current) fileRef.current.value = '' }

  async function uploadFile(hwId: string): Promise<string | null> {
    if (!file) return null
    const ext  = file.name.split('.').pop()
    const path = `tasks/${hwId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('homeworks').upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw new Error('Ошибка загрузки файла: ' + error.message)
    return supabase.storage.from('homeworks').getPublicUrl(path).data.publicUrl
  }

  async function onSubmit(values: FormValues) {
    setSubmitError('')
    if (!topicId) { setSubmitError('Выберите тему курса'); return }

    // resolve teacher (NOT NULL): own → group → любой учитель курса
    let tId = teacherId
    if (!tId && courseId) {
      const { data } = await supabase.from('groups').select('teacher_id')
        .eq('course_id', courseId).not('teacher_id', 'is', null).limit(1).maybeSingle()
      tId = (data as any)?.teacher_id || null
    }
    if (!tId) { setSubmitError('У курса нет преподавателя — назначьте учителя группе'); return }

    setUploading(!!file)
    try {
      const { data: hw, error } = await supabase
        .from('homeworks')
        .insert({
          title:       values.title,
          description: values.description || null,
          topic_id:    topicId,
          due_date:    new Date(values.due_date).toISOString(),
          max_score:   values.max_score,
          created_by:  tId,
          teacher_id:  tId,
          ...(defaultLessonId ? { lesson_id: defaultLessonId } : {}),
        } as any)
        .select('id')
        .single()
      if (error) throw error

      if (file && hw) {
        const url = await uploadFile(hw.id)
        if (url) await supabase.from('homeworks').update({ file_url: url }).eq('id', hw.id)
      }

      // уведомить учеников всех групп курса (ДЗ — общее для курса)
      if (courseId) {
        const { data: grps } = await supabase.from('groups').select('id').eq('course_id', courseId)
        for (const g of (grps || []) as any[]) {
          await notifyNewHomework(g.id, values.title, formatDate(values.due_date))
        }
      }

      reset(); setFile(null); setTopicId('')
      onCreated(); onClose()
    } catch (e: any) {
      setSubmitError(e.message || 'Ошибка при создании')
    } finally {
      setUploading(false)
    }
  }

  if (!open) return null
  const busy = isSubmitting || uploading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={20} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Новое домашнее задание</h2>
              <p className="text-xs text-gray-500">ДЗ привязывается к теме курса</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {loadingData ? (
            <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" /><span>Загрузка данных…</span>
            </div>
          ) : (
            <>
              <Input label="Название *" placeholder="Например: Задачи по кинематике §3"
                error={errors.title?.message} {...register('title')} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
                <textarea rows={2} placeholder="Дополнительные инструкции…"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  {...register('description')} />
              </div>

              {!courseLocked && (
                <Select
                  label="Курс *"
                  value={courseId}
                  onChange={e => setCourseId(e.target.value)}
                  options={[{ value: '', label: '— выберите курс —' }, ...courses.map(c => ({ value: c.id, label: c.label }))]}
                />
              )}

              <Select
                label="Тема курса *"
                value={topicId}
                onChange={e => setTopicId(e.target.value)}
                disabled={!courseId}
                options={[{ value: '', label: topics.length ? '— выберите тему —' : 'Нет тем в курсе' }, ...topics.map(t => ({ value: t.id, label: t.label }))]}
              />
              {!topicId && <p className="text-xs text-gray-400 -mt-2">ДЗ станет доступно всем группам этого курса</p>}
              {defaultLessonId && (
                <p className="text-xs text-primary-600 -mt-2 flex items-center gap-1">
                  <ClipboardList size={11} />Привязано к текущему уроку
                </p>
              )}

              <Input label="Срок сдачи *" type="datetime-local" error={errors.due_date?.message} {...register('due_date')} />
              <Input label="Максимальный балл *" type="number" min={1} max={100} error={errors.max_score?.message} {...register('max_score')} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Прикрепить файл задания</label>
                {file ? (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <FileText size={20} className="text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-blue-800 truncate">{file.name}</div>
                      <div className="text-xs text-blue-500">{(file.size / 1024).toFixed(0)} КБ</div>
                    </div>
                    <button type="button" onClick={removeFile} className="text-blue-400 hover:text-red-500 transition-colors"><XCircle size={18} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors">
                    <Paperclip size={16} />Прикрепить PDF / изображение
                  </button>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
                <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG — до 10 МБ</p>
              </div>

              {submitError && <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{submitError}</p>}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
                <Button type="submit" loading={busy} className="flex-1">Создать ДЗ</Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
