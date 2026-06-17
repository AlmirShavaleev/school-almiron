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

const schema = z.object({
  title:       z.string().min(3, 'Минимум 3 символа'),
  description: z.string().optional(),
  group_id:    z.string().min(1, 'Выберите группу'),
  due_date:    z.string().min(1, 'Укажите срок сдачи'),
  max_score:   z.coerce.number().min(1).max(100),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
  /** Pre-fill and lock the group selector */
  defaultGroupId?: string
  /** Pre-fill and lock the lesson selector */
  defaultLessonId?: string
  /** Pre-fill and lock the topic selector */
  defaultTopicId?: string
}

export function CreateHomeworkModal({ open, onClose, onCreated, defaultGroupId, defaultLessonId, defaultTopicId }: Props) {
  const profile = useAuthStore(s => s.profile)
  const [groups, setGroups]           = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [teacherId, setTeacherId]     = useState<string | null>(null)
  const [submitError, setSubmitError] = useState('')

  // File state
  const [file, setFile]         = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    mode: 'onChange',
    resolver: zodResolver(schema) as any,
    defaultValues: { max_score: 100, group_id: defaultGroupId || '' },
  })

  useEffect(() => {
    if (!open || !profile) return
    setLoadingData(true)
    setSubmitError('')
    setFile(null)
    // Pre-fill group if passed
    if (defaultGroupId) setValue('group_id', defaultGroupId)

    async function loadData() {
      try {
        if (profile!.role === 'teacher') {
          const { data: tc } = await supabase
            .from('teachers').select('id').eq('profile_id', profile!.id).single()
          if (tc) {
            setTeacherId(tc.id)
            const { data: gs } = await supabase
              .from('groups').select('id, name').eq('teacher_id', tc.id)
            setGroups(gs || [])
          }
        } else {
          const { data: gs } = await supabase
            .from('groups').select('id, name').order('name')
          setGroups(gs || [])
        }
      } finally {
        setLoadingData(false)
      }
    }
    loadData()
  }, [open, profile])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      setSubmitError('Файл слишком большой. Максимум 10 МБ.')
      return
    }
    setFile(f)
    setSubmitError('')
  }

  function removeFile() {
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function uploadFile(hwId: string): Promise<string | null> {
    if (!file) return null
    const ext  = file.name.split('.').pop()
    const path = `tasks/${hwId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('homeworks')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw new Error('Ошибка загрузки файла: ' + error.message)
    const { data } = supabase.storage.from('homeworks').getPublicUrl(path)
    return data.publicUrl
  }

  async function onSubmit(values: FormValues) {
    setSubmitError('')
    setUploading(!!file)
    try {
      // Insert homework first to get ID
      const { data: hw, error } = await supabase
        .from('homeworks')
        .insert({
          title:       values.title,
          description: values.description || null,
          group_id:    values.group_id,
          due_date:    new Date(values.due_date).toISOString(),
          max_score:   values.max_score,
          created_by:  teacherId!,
          ...(defaultLessonId ? { lesson_id: defaultLessonId } : {}),
          ...(defaultTopicId  ? { topic_id:  defaultTopicId  } : {}),
        } as any)
        .select('id')
        .single()

      if (error) throw error

      // Upload file and update file_url if file selected
      if (file && hw) {
        const fileUrl = await uploadFile(hw.id)
        if (fileUrl) {
          await supabase.from('homeworks').update({ file_url: fileUrl }).eq('id', hw.id)
        }
      }

      // Уведомить студентов группы
      notifyNewHomework(
        values.group_id,
        values.title,
        formatDate(values.due_date),
      )

      reset()
      setFile(null)
      onCreated()
      onClose()
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

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={20} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Новое домашнее задание</h2>
              <p className="text-xs text-gray-500">Заполните детали</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {loadingData ? (
            <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />
              <span>Загрузка данных…</span>
            </div>
          ) : (
            <>
              <Input
                label="Название *"
                placeholder="Например: Задачи по кинематике §3"
                error={errors.title?.message}
                {...register('title')}
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
                <textarea
                  rows={2}
                  placeholder="Дополнительные инструкции…"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  {...register('description')}
                />
              </div>

              <Select
                label="Группа *"
                error={errors.group_id?.message}
                disabled={!!defaultGroupId}
                options={[
                  { value: '', label: '— выберите группу —' },
                  ...groups.map(g => ({ value: g.id, label: g.name })),
                ]}
                {...register('group_id')}
              />
              {defaultLessonId && (
                <p className="text-xs text-primary-600 -mt-2 flex items-center gap-1">
                  <ClipboardList size={11} />ДЗ будет привязано к текущему уроку
                </p>
              )}

              <Input
                label="Срок сдачи *"
                type="datetime-local"
                error={errors.due_date?.message}
                {...register('due_date')}
              />

              <Input
                label="Максимальный балл *"
                type="number"
                min={1}
                max={100}
                error={errors.max_score?.message}
                {...register('max_score')}
              />

              {/* File attachment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Прикрепить файл задания
                </label>
                {file ? (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <FileText size={20} className="text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-blue-800 truncate">{file.name}</div>
                      <div className="text-xs text-blue-500">{(file.size / 1024).toFixed(0)} КБ</div>
                    </div>
                    <button type="button" onClick={removeFile} className="text-blue-400 hover:text-red-500 transition-colors">
                      <XCircle size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors"
                  >
                    <Paperclip size={16} />
                    Прикрепить PDF / изображение
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG — до 10 МБ</p>
              </div>

              {submitError && (
                <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{submitError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
                  Отмена
                </Button>
                <Button type="submit" className="flex-1" loading={busy} disabled={loadingData}>
                  {uploading ? 'Загрузка файла…' : 'Создать ДЗ'}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
